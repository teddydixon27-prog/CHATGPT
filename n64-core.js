(function (Scratch) {
  'use strict';

  const RAM_SIZE = 8 * 1024 * 1024;
  const ROM_BASE = 0x10000000;
  const MASK32 = 0xffffffffn;
  const MASK64 = 0xffffffffffffffffn;

  class N64Core {
    constructor() {
      this.ram = new Uint8Array(RAM_SIZE);
      this.rom = new Uint8Array(0);
      this.regs = Array(32).fill(0n);
      this.pc = ROM_BASE;
      this.cycles = 0;
      this.halted = false;
      this.lastError = '';
      this.pendingTarget = null;
      this.lastInstruction = 0;
      this.reset();
    }

    getInfo() {
      return {
        id: 'n64core',
        name: 'N64 CPU Core',
        color1: '#3869a8',
        color2: '#2d568c',
        color3: '#244674',
        blocks: [
          { opcode: 'reset', blockType: Scratch.BlockType.COMMAND, text: 'reset N64 CPU' },
          { opcode: 'loadRomHex', blockType: Scratch.BlockType.COMMAND, text: 'load ROM hex [DATA]', arguments: { DATA: { type: Scratch.ArgumentType.STRING, defaultValue: '00000000' } } },
          { opcode: 'setPC', blockType: Scratch.BlockType.COMMAND, text: 'set PC to [ADDRESS]', arguments: { ADDRESS: { type: Scratch.ArgumentType.NUMBER, defaultValue: ROM_BASE } } },
          { opcode: 'step', blockType: Scratch.BlockType.COMMAND, text: 'execute 1 instruction' },
          { opcode: 'run', blockType: Scratch.BlockType.COMMAND, text: 'run [COUNT] instructions', arguments: { COUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1000 } } },
          { opcode: 'stop', blockType: Scratch.BlockType.COMMAND, text: 'stop CPU' },
          { opcode: 'setRegister', blockType: Scratch.BlockType.COMMAND, text: 'set register [REG] to [VALUE]', arguments: { REG: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }, VALUE: { type: Scratch.ArgumentType.STRING, defaultValue: '0' } } },
          { opcode: 'writeWord', blockType: Scratch.BlockType.COMMAND, text: 'write memory word at [ADDRESS] value [VALUE]', arguments: { ADDRESS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, VALUE: { type: Scratch.ArgumentType.STRING, defaultValue: '0' } } },
          { opcode: 'getRegister', blockType: Scratch.BlockType.REPORTER, text: 'register [REG]', arguments: { REG: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },
          { opcode: 'getPC', blockType: Scratch.BlockType.REPORTER, text: 'N64 PC' },
          { opcode: 'getCycles', blockType: Scratch.BlockType.REPORTER, text: 'N64 cycles' },
          { opcode: 'getLastInstruction', blockType: Scratch.BlockType.REPORTER, text: 'last instruction hex' },
          { opcode: 'readWord', blockType: Scratch.BlockType.REPORTER, text: 'read memory word at [ADDRESS]', arguments: { ADDRESS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },
          { opcode: 'getStatus', blockType: Scratch.BlockType.REPORTER, text: 'N64 CPU status' },
          { opcode: 'getError', blockType: Scratch.BlockType.REPORTER, text: 'N64 CPU error' },
          { opcode: 'romSize', blockType: Scratch.BlockType.REPORTER, text: 'N64 ROM size' }
        ]
      };
    }

    reset() {
      this.regs = Array(32).fill(0n);
      this.pc = ROM_BASE;
      this.cycles = 0;
      this.halted = false;
      this.lastError = '';
      this.pendingTarget = null;
      this.lastInstruction = 0;
    }

    asU64(v) { return BigInt.asUintN(64, BigInt(v)); }
    asS64(v) { return BigInt.asIntN(64, BigInt(v)); }
    s32(v) { return BigInt.asIntN(32, BigInt(v)); }
    u32(v) { return BigInt.asUintN(32, BigInt(v)); }
    signedImm(v) { return BigInt.asIntN(16, BigInt(v & 0xffff)); }
    reg(i) { return this.regs[i & 31]; }
    setReg(i, v) { if ((i & 31) !== 0) this.regs[i & 31] = this.asU64(v); this.regs[0] = 0n; }

    physical(address) { return Number(BigInt.asUintN(32, BigInt(address)) & 0x1fffffffn); }

    readByte(address) {
      const a = this.physical(address);
      if (a < RAM_SIZE) return this.ram[a];
      if (a >= ROM_BASE && a < ROM_BASE + this.rom.length) return this.rom[a - ROM_BASE];
      throw new Error('Read outside mapped RAM/ROM: 0x' + a.toString(16));
    }

    writeByte(address, value) {
      const a = this.physical(address);
      if (a >= RAM_SIZE) throw new Error('Write outside mapped RDRAM: 0x' + a.toString(16));
      this.ram[a] = Number(value) & 255;
    }

    readWord(address) {
      const a = BigInt(address);
      if ((a & 3n) !== 0n) throw new Error('Unaligned 32-bit read at 0x' + a.toString(16));
      return (BigInt(this.readByte(a)) << 24n) |
        (BigInt(this.readByte(a + 1n)) << 16n) |
        (BigInt(this.readByte(a + 2n)) << 8n) |
        BigInt(this.readByte(a + 3n));
    }

    writeWord(address, value) {
      const a = BigInt(address);
      if ((a & 3n) !== 0n) throw new Error('Unaligned 32-bit write at 0x' + a.toString(16));
      const v = this.u32(value);
      this.writeByte(a, v >> 24n);
      this.writeByte(a + 1n, v >> 16n);
      this.writeByte(a + 2n, v >> 8n);
      this.writeByte(a + 3n, v);
    }

    readDouble(address) {
      const a = BigInt(address);
      if ((a & 7n) !== 0n) throw new Error('Unaligned 64-bit read at 0x' + a.toString(16));
      return (this.readWord(a) << 32n) | this.readWord(a + 4n);
    }

    writeDouble(address, value) {
      const a = BigInt(address), v = this.asU64(value);
      if ((a & 7n) !== 0n) throw new Error('Unaligned 64-bit write at 0x' + a.toString(16));
      this.writeWord(a, v >> 32n);
      this.writeWord(a + 4n, v);
    }

    loadRomHex(args) {
      const raw = String(args.DATA || '').replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
      if (raw.length % 2) throw new Error('ROM hex must contain complete bytes');
      const bytes = new Uint8Array(raw.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
      this.rom = bytes;
      this.reset();
    }

    fetch() {
      if ((this.pc & 3n) !== 0n) throw new Error('Unaligned instruction address');
      return Number(this.readWord(this.pc));
    }

    branch(target) { this.pendingTarget = BigInt.asUintN(32, target); }

    executeOne() {
      if (this.halted) return;
      try {
        const currentPC = this.pc;
        const applyTarget = this.pendingTarget;
        this.pendingTarget = null;
        const ins = this.fetch() >>> 0;
        this.lastInstruction = ins;
        const op = ins >>> 26;
        const rs = (ins >>> 21) & 31;
        const rt = (ins >>> 16) & 31;
        const rd = (ins >>> 11) & 31;
        const sh = (ins >>> 6) & 31;
        const fn = ins & 63;
        const imm = ins & 0xffff;
        const simm = this.signedImm(imm);
        const a = this.reg(rs), b = this.reg(rt);
        const next = currentPC + 4n;
        let result;

        if (op === 0) {
          switch (fn) {
            case 0x00: this.setReg(rd, this.s32(this.u32(b) << BigInt(sh))); break;
            case 0x02: this.setReg(rd, this.s32(this.u32(b) >> BigInt(sh))); break;
            case 0x03: this.setReg(rd, this.s32(this.s32(b) >> BigInt(sh))); break;
            case 0x04: this.setReg(rd, this.s32(this.u32(b) << (a & 31n))); break;
            case 0x06: this.setReg(rd, this.s32(this.u32(b) >> (a & 31n))); break;
            case 0x07: this.setReg(rd, this.s32(this.s32(b) >> (a & 31n))); break;
            case 0x08: this.branch(a); break;
            case 0x09: this.setReg(rd || 31, next + 4n); this.branch(a); break;
            case 0x0d: this.halted = true; this.lastError = 'BREAK instruction'; break;
            case 0x20: case 0x21: this.setReg(rd, this.s32(this.s32(a) + this.s32(b))); break;
            case 0x22: case 0x23: this.setReg(rd, this.s32(this.s32(a) - this.s32(b))); break;
            case 0x24: this.setReg(rd, a & b); break;
            case 0x25: this.setReg(rd, a | b); break;
            case 0x26: this.setReg(rd, a ^ b); break;
            case 0x27: this.setReg(rd, ~(a | b)); break;
            case 0x2a: this.setReg(rd, this.s32(a) < this.s32(b) ? 1n : 0n); break;
            case 0x2b: this.setReg(rd, a < b ? 1n : 0n); break;
            case 0x2c: this.setReg(rd, this.asS64(a + b)); break;
            case 0x2d: this.setReg(rd, a + b); break;
            case 0x2e: this.setReg(rd, this.asS64(a - b)); break;
            case 0x2f: this.setReg(rd, a - b); break;
            case 0x38: this.setReg(rd, this.asS64(a << BigInt(sh))); break;
            case 0x3a: this.setReg(rd, this.asS64(a >> BigInt(sh))); break;
            case 0x3b: this.setReg(rd, a >> BigInt(sh)); break;
            case 0x3c: this.setReg(rd, this.asS64(a << BigInt(sh + 32))); break;
            case 0x3e: this.setReg(rd, this.asS64(a >> BigInt(sh + 32))); break;
            case 0x3f: this.setReg(rd, a >> BigInt(sh + 32)); break;
            default: throw new Error('Unsupported SPECIAL function 0x' + fn.toString(16));
          }
        } else {
          switch (op) {
            case 0x02: {
              const target = ((next & 0xf0000000n) | (BigInt(ins & 0x03ffffff) << 2n));
              this.branch(target); break;
            }
            case 0x03: {
              this.setReg(31, next + 4n);
              this.branch((next & 0xf0000000n) | (BigInt(ins & 0x03ffffff) << 2n)); break;
            }
            case 0x04: if (a === b) this.branch(next + (simm << 2n)); break;
            case 0x05: if (a !== b) this.branch(next + (simm << 2n)); break;
            case 0x06: if (this.asS64(a) <= 0n) this.branch(next + (simm << 2n)); break;
            case 0x07: if (this.asS64(a) > 0n) this.branch(next + (simm << 2n)); break;
            case 0x08: case 0x09: this.setReg(rt, this.asS64(a + simm)); break;
            case 0x0a: this.setReg(rt, this.asS64(a) < simm ? 1n : 0n); break;
            case 0x0b: this.setReg(rt, a < this.asU64(simm) ? 1n : 0n); break;
            case 0x0c: this.setReg(rt, a & BigInt(imm)); break;
            case 0x0d: this.setReg(rt, a | BigInt(imm)); break;
            case 0x0e: this.setReg(rt, a ^ BigInt(imm)); break;
            case 0x0f: this.setReg(rt, this.s32(BigInt(imm) << 16n)); break;
            case 0x14: if (a === b) this.branch(next + (simm << 2n)); break;
            case 0x15: if (a !== b) this.branch(next + (simm << 2n)); break;
            case 0x18: this.setReg(rt, this.asS64(a + simm)); break;
            case 0x19: this.setReg(rt, a + simm); break;
            case 0x20: this.setReg(rt, BigInt.asIntN(64, BigInt(this.readByte(a + simm) << 24) >> 24n)); break;
            case 0x21: {
              const v = (this.readByte(a+simm) << 8) | this.readByte(a+simm+1n);
              this.setReg(rt, BigInt.asIntN(16, BigInt(v))); break;
            }
            case 0x23: this.setReg(rt, this.s32(this.readWord(a + simm))); break;
            case 0x24: this.setReg(rt, BigInt(this.readByte(a + simm))); break;
            case 0x25: {
              const v = (this.readByte(a+simm) << 8) | this.readByte(a+simm+1n);
              this.setReg(rt, BigInt(v)); break;
            }
            case 0x27: this.setReg(rt, this.readWord(a + simm)); break;
            case 0x28: this.writeByte(a + simm, b); break;
            case 0x29: this.writeByte(a + simm, b >> 8n); this.writeByte(a + simm + 1n, b); break;
            case 0x2b: this.writeWord(a + simm, b); break;
            case 0x37: this.setReg(rt, this.readDouble(a + simm)); break;
            case 0x3f: this.writeDouble(a + simm, b); break;
            default: throw new Error('Unsupported opcode 0x' + op.toString(16));
          }
        }

        this.pc = applyTarget !== null ? applyTarget : next;
        this.cycles++;
        this.regs[0] = 0n;
      } catch (e) {
        this.halted = true;
        this.lastError = String(e && e.message ? e.message : e);
      }
    }

    run(args) {
      const count = Math.max(0, Math.min(100000, Math.floor(Number(args.COUNT) || 0)));
      for (let i = 0; i < count && !this.halted; i++) this.executeOne();
    }

    setRegister(args) {
      const i = Math.max(0, Math.min(31, Math.floor(Number(args.REG) || 0)));
      let v;
      try { v = BigInt(String(args.VALUE)); } catch (_) { v = BigInt(Math.trunc(Number(args.VALUE) || 0)); }
      this.setReg(i, v);
    }

    writeWordBlock(args) {
      try { this.writeWord(BigInt(Math.trunc(Number(args.ADDRESS) || 0)), BigInt(String(args.VALUE))); }
      catch (e) { this.lastError = String(e.message || e); }
    }

    getRegister(args) {
      const i = Math.max(0, Math.min(31, Math.floor(Number(args.REG) || 0)));
      return this.reg(i).toString();
    }
    getPC() { return this.pc.toString(); }
    getCycles() { return this.cycles; }
    getLastInstruction() { return '0x' + this.lastInstruction.toString(16).padStart(8, '0'); }
    readWordBlock(args) {
      try { return this.readWord(BigInt(Math.trunc(Number(args.ADDRESS) || 0))).toString(); }
      catch (e) { this.lastError = String(e.message || e); return '0'; }
    }
    getStatus() { return this.halted ? 'HALTED' : 'RUNNING'; }
    getError() { return this.lastError; }
    romSize() { return this.rom.length; }
    setPC(args) { this.pc = BigInt(Math.trunc(Number(args.ADDRESS) || 0)); this.pendingTarget = null; this.halted = false; this.lastError = ''; }
    stop() { this.halted = true; }
    step() { this.executeOne(); }
  }

  Scratch.extensions.register(new N64Core());
})(Scratch);
