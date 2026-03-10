import { Buffer } from 'buffer'
import process from 'process'

// Provide Node-like globals before loading app modules.
;(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer
;(globalThis as typeof globalThis & { process: typeof process }).process = process

void import('./bootstrap')
