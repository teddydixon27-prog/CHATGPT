# TurboWarp N64 CPU Core

This repository now includes `n64-core.js`, a TurboWarp custom extension containing a standalone MIPS III / R4300i-inspired CPU core and memory system.

## Load it in TurboWarp

1. Open the project in TurboWarp.
2. Open **Add Extension**.
3. Choose **Custom Extension**.
4. Paste this URL:

   `https://raw.githubusercontent.com/teddydixon27-prog/CHATGPT/main/n64-core.js`

5. Add the **N64 CPU Core** extension.

The existing Scratch CPU blocks are preserved. The new extension provides a faster JavaScript CPU/memory core alongside them; it is not yet wired into the old Scratch dispatcher.

## First test

Use these blocks in order:

1. `reset N64 CPU`
2. `load ROM hex [DATA]` with this exact hex string:

   `240100052402000700221821AC0300008C0400000000000D`

3. `run [6] instructions`

Expected results:

- `register [1]` = `5`
- `register [2]` = `7`
- `register [3]` = `12`
- `register [4]` = `12`
- `read memory word at [0]` = `12`
- CPU status = `HALTED` (the final instruction is BREAK)

## Current implementation

- 32 64-bit general-purpose registers; register zero is hardwired to zero.
- 8 MiB byte-addressed RDRAM.
- Big-endian byte, halfword, word and doubleword memory access.
- Cartridge ROM loaded from hexadecimal bytes at `0x10000000`.
- Program counter, cycle counter, instruction stepping and bounded run batches.
- MIPS-style branch delay slots.
- Integer arithmetic, logical operations, shifts, comparisons, branches, jumps, loads and stores.

Implemented instruction families include SPECIAL arithmetic/logical/shift/jump operations, ADDI/ADDIU, DADDI/DADDIU, SLTI/SLTIU, ANDI/ORI/XORI/LUI, BEQ/BNE/BLEZ/BGTZ, J/JAL, LB/LBU/LH/LHU/LW/LWU/LD and SB/SH/SW/SD.

## Important limitations

This is a CPU and basic memory core, not a complete Nintendo 64 emulator yet. It does not currently emulate the RSP, RDP graphics pipeline, VI display, AI audio, PI/SI/MI peripherals, PIF boot ROM, cartridge header/byte-order variants, TLB, CP0 exception handling, floating-point COP1, or the full R4300i instruction set. Commercial N64 games will not boot yet. The 8 MiB RAM array models the maximum expanded RDRAM size, not the complete N64 memory map.

The core is deliberately separate from `project.json` for now so the existing Scratch project is not overwritten or corrupted. The extension must be loaded by URL in TurboWarp.
