/**
 * Desktop-side logging: one append stream under the app's userData/logs
 * directory, shared by every main-process module. The embedded harness engine
 * writes its own stream (see harness.mjs); this module covers the desktop shell
 * itself plus small helpers the error page needs.
 * @module log
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Logs are rotated by truncation once they pass this size. */
const MAX_LOG_BYTES = 2 * 1024 * 1024

/** Directory that holds the desktop shell's own log files. */
export const MAIN_LOG_FILENAME = 'main.log'

let logDir = ''
let stream = undefined

/**
 * Create the log directory and open (or truncate) the main log stream.
 * @param dir - absolute path of the logs directory.
 * @returns the absolute path of the main log file.
 */
export function initLogs(dir) {
  logDir = dir
  mkdirSync(dir, { recursive: true })
  const file = join(dir, MAIN_LOG_FILENAME)
  if (existsSync(file)) {
    try {
      if (statSync(file).size > MAX_LOG_BYTES) {
        // Truncate in place; the stream below reopens in append mode.
        stream = createWriteStream(file, { flags: 'w' })
        stream.end()
      }
    } catch {
      // A racing reader (error page) may hold the file; falling back to append is safe.
    }
  }
  stream = createWriteStream(file, { flags: 'a' })
  return file
}

/**
 * Write one timestamped line to stdout and the log stream.
 * @param level - severity label used verbatim in the line.
 * @param message - line content.
 */
export function log(level, message) {
  const line = `${new Date().toISOString()} [${level}] ${message}`
  console.log(line)
  stream?.write(`${line}\n`)
}

/** Absolute path of the directory initLogs was called with. */
export function currentLogDir() {
  return logDir
}

/**
 * Read the last `maxLines` lines of a text file, newest last.
 * @param file - absolute path of the file to tail.
 * @param maxLines - maximum number of lines returned.
 * @returns the tail as one string, or an explanatory string when unreadable.
 */
export function readTail(file, maxLines) {
  try {
    if (!existsSync(file)) return '(no log file yet)'
    const text = readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/).filter((line) => line !== '')
    return lines.slice(-maxLines).join('\n')
  } catch (error) {
    return `(cannot read ${file}: ${String(error)})`
  }
}
