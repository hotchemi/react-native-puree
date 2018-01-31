import Queue, { QueueItem } from './queue'

export type Log = object
export type OutputHandler = (logs: Log[]) => Promise<void>
export type PureeFilter = (log: Log) => Log

async function wait (interval: number) {
  await new Promise((resolve) => { setTimeout(resolve, interval) })
}

export interface PureeConfig {
  flushInterval?: number
  maxRetry?: number
  firstRetryInterval?: number
}

export default class Puree {
  static DEFAULT_FLUSH_INTERVAL = 2 * 60 * 1000
  static LOG_LIMIT = 10
  static DEFAULT_MAX_RETRY = 5
  static DEFAULT_FIRST_RETRY_INTERVAL = 1 * 1000

  queue: Queue
  buffer: QueueItem[]
  filters: PureeFilter[]

  // config
  flushInterval: number
  maxRetry: number
  firstRetryInterval: number

  _flushHandler: OutputHandler

  constructor (config: PureeConfig = {}) {
    this.queue = new Queue()
    this.filters = []
    this.flushInterval = config.flushInterval || Puree.DEFAULT_FLUSH_INTERVAL
    this.maxRetry = config.maxRetry || Puree.DEFAULT_MAX_RETRY
    this.firstRetryInterval = config.firstRetryInterval || Puree.DEFAULT_FIRST_RETRY_INTERVAL
  }

  addFilter (f: PureeFilter) {
    this.filters.push(f)
  }

  addOutput (handler: OutputHandler) {
    this._flushHandler = handler
  }

  async start () {
    if (!this.buffer) await this._init()

    this._flush()

    setInterval(() => {
      this._flush()
    }, this.flushInterval)
  }

  async send (log: Log) {
    log = this.applyFilters(log)

    const queueItem = await this.queue.push(log)
    this.buffer.push(queueItem)
  }

  applyFilters (value): Log {
    this.filters.forEach(f => {
      value = f(value)
    })

    return value
  }

  async _init () {
    this.buffer = await this.queue.get()
  }

  async _flush () {
    const items = this.buffer.splice(0, Puree.LOG_LIMIT)

    if (items.length === 0) return
    const logs = items.map(item => item.data)

    const handledError = await this._process(logs)
    if (handledError) {
      console.error(handledError)
      return
    }

    return this.queue.remove(items)
  }

  async _process (logs: Log[], retryCount = 0): Promise<Error> {
    if (retryCount > this.maxRetry) {
      return new Error('retryCount exceeded max retry')
    }

    try {
      await this._flushHandler(logs)
    } catch {
      await wait(Math.pow(2, retryCount) * this.firstRetryInterval)
      return this._process(logs, retryCount + 1)
    }
  }
}
