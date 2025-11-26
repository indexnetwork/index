const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const RENDER_INTERVAL_MS = 200;

class TerminalRenderer {
  private lastLineCount = 0;
  private lastSnapshot = '';

  update(text: string): void {
    if (!process.stdout.isTTY) {
      if (text !== this.lastSnapshot) {
        console.log(text);
        this.lastSnapshot = text;
      }
      return;
    }

    const erase = '\u001B[2K\u001B[1A';
    const clearLines = erase.repeat(this.lastLineCount);
    const cursorToStart = '\u001B[2K\r';
    process.stdout.write(clearLines + cursorToStart + text);
    this.lastLineCount = text.split('\n').length;
  }

  clear(): void {
    if (!process.stdout.isTTY) return;
    const erase = '\u001B[2K\u001B[1A';
    const clearLines = erase.repeat(this.lastLineCount);
    process.stdout.write(clearLines + '\u001B[2K\r');
    this.lastLineCount = 0;
  }

  done(): void {
    if (!process.stdout.isTTY) return;
    process.stdout.write('\n');
    this.lastLineCount = 0;
  }
}

type ChannelState = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  messages: number;
  currentPage?: number;
  totalPages?: number;
  hasMore?: boolean;
  lastMessageAt?: string;
  rateLimitEndsAt?: number;
};

export interface SlackSyncState {
  integrationId: string;
  since: string;
  cycle: number;
  totalChannels: number;
  selectedChannels: number;
  channels: ChannelState[];
  usersCreated: number;
  startTime: number;
  endTime?: number;
  waitUntil?: number;
}

export class SlackProgressLogger {
  private states: Map<string, SlackSyncState> = new Map();
  private nextSyncEta: number | null = null;
  private activeIntegrations = 0;
  private spinnerIndex = 0;
  private renderTimer?: NodeJS.Timeout;
  private renderer = new TerminalRenderer();

  setActiveIntegrationIds(integrationIds: string[]): void {
    this.activeIntegrations = integrationIds.length;
    const idSet = new Set(integrationIds);

    for (const id of integrationIds) {
      this.getOrCreateState(id);
    }

    for (const existingId of Array.from(this.states.keys())) {
      if (!idSet.has(existingId)) {
        this.states.delete(existingId);
      }
    }

    if (this.activeIntegrations === 0) {
      this.nextSyncEta = null;
    }

    this.ensureRenderLoop();
    this.render();
  }

  removeIntegration(integrationId: string): void {
    this.states.delete(integrationId);
    this.ensureRenderLoop();
    this.render();
  }

  updateIntegrationStart(integrationId: string, since: string): void {
    const state = this.getOrCreateState(integrationId);
    state.cycle += 1;
    state.since = since;
    state.startTime = Date.now();
    state.endTime = undefined;
    state.usersCreated = 0;
    state.waitUntil = undefined;
    state.channels = state.channels.map(channel => ({
      ...channel,
      status: 'pending',
      messages: 0,
      currentPage: undefined,
      totalPages: undefined,
      hasMore: undefined,
      lastMessageAt: undefined,
      rateLimitEndsAt: undefined
    }));

    this.ensureRenderLoop();
    this.render();
  }

  updateChannelCounts(integrationId: string, total: number, selected: number): void {
    const state = this.getOrCreateState(integrationId);
    state.totalChannels = total;
    state.selectedChannels = selected;
    this.render();
  }

  setChannels(
    integrationId: string,
    channels: { id: string; name: string }[]
  ): void {
    const state = this.getOrCreateState(integrationId);
    const existing = new Map(state.channels.map(ch => [ch.id, ch]));
    state.channels = channels.map(ch => {
      const prev = existing.get(ch.id);
      return prev
        ? { ...prev, name: ch.name }
        : {
            id: ch.id,
            name: ch.name,
            status: 'pending',
            messages: 0
          };
    });
    this.render();
  }

  updateChannelStatus(
    integrationId: string,
    channelId: string,
    status: 'running' | 'done' | 'error',
    messages?: number
  ): void {
    const channel = this.getOrCreateChannel(integrationId, channelId);
    channel.status = status;
    if (messages !== undefined) {
      channel.messages = messages;
    }
    if (status !== 'running') {
      channel.currentPage = undefined;
      channel.hasMore = undefined;
    }
    this.render();
  }

  updateChannelProgress(
    integrationId: string,
    channelId: string,
    progress: {
      currentPage: number;
      hasMore: boolean;
      lastMessageAt?: Date;
      messagesProcessed?: number;
    }
  ): void {
    const channel = this.getOrCreateChannel(integrationId, channelId);
    channel.currentPage = progress.currentPage;
    channel.hasMore = progress.hasMore;
    if (!progress.hasMore) {
      channel.totalPages = progress.currentPage;
    }
    if (progress.messagesProcessed !== undefined) {
      channel.messages = progress.messagesProcessed;
    }
    if (progress.lastMessageAt) {
      channel.lastMessageAt = progress.lastMessageAt.toISOString();
    }
    this.render();
  }

  updateRateLimit(
    integrationId: string,
    channelId: string,
    delayMs: number
  ): void {
    const channel = this.getOrCreateChannel(integrationId, channelId);
    channel.rateLimitEndsAt = Date.now() + delayMs;
    this.render();
  }

  clearRateLimit(integrationId: string, channelId: string): void {
    const channel = this.getOrCreateChannel(integrationId, channelId);
    channel.rateLimitEndsAt = undefined;
    this.render();
  }

  incrementUsersCreated(integrationId: string, count = 1): void {
    const state = this.getOrCreateState(integrationId);
    state.usersCreated += count;
    this.render();
  }

  completeIntegration(integrationId: string): void {
    const state = this.getOrCreateState(integrationId);
    state.endTime = Date.now();
    state.waitUntil = undefined;
    this.render();
  }

  setNextSyncIn(seconds: number): void {
    const eta = Date.now() + (seconds * 1000);
    this.nextSyncEta = this.nextSyncEta ? Math.min(this.nextSyncEta, eta) : eta;
    this.ensureRenderLoop();
    this.render();
  }

  setIntegrationWait(integrationId: string, seconds: number): void {
    const state = this.getOrCreateState(integrationId);
    state.waitUntil = Date.now() + seconds * 1000;
    this.render();
  }

  stop(): void {
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = undefined;
    }
    this.renderer.clear();
    this.renderer.done();
  }

  private ensureRenderLoop(): void {
    if (this.renderTimer) return;
    this.renderTimer = setInterval(() => this.render(), RENDER_INTERVAL_MS);
  }

  private render(): void {
    const spinner = this.nextSpinnerFrame();
    const header = this.renderHeader(spinner);
    const sections: string[] = [header];

    if (this.states.size === 0) {
      sections.push('', 'No active Slack syncs right now.');
    } else {
      const orderedStates = Array.from(this.states.values()).sort((a, b) =>
        a.integrationId.localeCompare(b.integrationId)
      );
      for (const state of orderedStates) {
        sections.push('', this.renderIntegration(state, spinner));
      }
    }

    this.renderer.update(sections.join('\n'));
  }

  private renderHeader(spinner: string): string {
    const nextSyncText = this.nextSyncEta
      ? `${Math.max(0, Math.ceil((this.nextSyncEta - Date.now()) / 1000))}s`
      : this.activeIntegrations > 0
        ? 'syncing...'
        : 'scheduling...';

    return `${spinner} Slack Integration Worker | Next sync in: ${nextSyncText} | Active integrations: ${this.activeIntegrations}`;
  }

  private renderIntegration(state: SlackSyncState, spinner: string): string {
    const elapsedMs = (state.endTime ?? Date.now()) - state.startTime;
    const duration = this.formatDuration(elapsedMs);
    let titleIcon = spinner;
    let statusLabel = `[cycle ${state.cycle} running ${duration}]`;

    if (state.waitUntil && state.waitUntil > Date.now()) {
      titleIcon = '⏳';
      const waitSecs = Math.max(1, Math.ceil((state.waitUntil - Date.now()) / 1000));
      statusLabel = `[cycle ${state.cycle} waiting ${waitSecs}s]`;
    } else if (state.endTime) {
      titleIcon = '✔';
      statusLabel = `(cycle ${state.cycle} finished in ${duration})`;
    }

    const lines = [
      `${titleIcon} Integration ${state.integrationId.slice(0, 8)}... ${statusLabel}`,
      `  ⏱️  Elapsed: ${state.endTime ? duration : `${duration} (running)`}`,
      `  Since: ${state.since || 'loading...'}`,
      `  Channels: ${state.selectedChannels}/${state.totalChannels} selected`,
      `  Users created: ${state.usersCreated}`
    ];

    if (state.endTime) {
      const messageCount = state.channels.reduce((sum, ch) => sum + ch.messages, 0);
      lines.push(`  Messages processed: ${messageCount}`);
    }

    lines.push('');

    for (const channel of state.channels) {
      lines.push(`  ${this.renderChannelLine(channel, spinner)}`);
    }

    const pendingCount = Math.max(0, state.selectedChannels - state.channels.length);
    for (let i = 0; i < pendingCount; i++) {
      lines.push('  ⏳ [pending]');
    }

    return lines.join('\n');
  }

  private renderChannelLine(channel: ChannelState, spinner: string): string {
    if (channel.status === 'done') {
      return `✅ ${channel.name} (${channel.messages} msgs)`;
    }

    if (channel.status === 'error') {
      return `❌ ${channel.name} [error]`;
    }

    let label = channel.status === 'running' ? `${spinner} ${channel.name}` : `⏳ ${channel.name}`;

    if (channel.currentPage) {
      const pageDisplay = channel.hasMore
        ? `${channel.currentPage}+`
        : channel.totalPages
          ? `${channel.currentPage}/${channel.totalPages}`
          : `${channel.currentPage}`;
      label += ` (page ${pageDisplay})`;
    }

    const details: string[] = [];

    if (channel.lastMessageAt) {
      details.push(`last ${this.formatTimestamp(channel.lastMessageAt)}`);
    }

    if (channel.messages) {
      details.push(`${channel.messages} msgs`);
    }

    if (details.length > 0) {
      label += ` | ${details.join(' · ')}`;
    }

    if (channel.rateLimitEndsAt) {
      const remaining = Math.max(0, Math.ceil((channel.rateLimitEndsAt - Date.now()) / 1000));
      label += ` [⏸️  ${remaining}s]`;
    }

    return label;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.max(1, Math.floor(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  }

  private nextSpinnerFrame(): string {
    const frame = SPINNER_FRAMES[this.spinnerIndex];
    this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
    return frame;
  }

  private getOrCreateState(integrationId: string): SlackSyncState {
    let state = this.states.get(integrationId);
    if (!state) {
      state = {
        integrationId,
        since: '',
        cycle: 0,
        totalChannels: 0,
        selectedChannels: 0,
        channels: [],
        usersCreated: 0,
        startTime: Date.now()
      };
      this.states.set(integrationId, state);
    }
    return state;
  }

  private getOrCreateChannel(integrationId: string, channelId: string): ChannelState {
    const state = this.getOrCreateState(integrationId);
    let channel = state.channels.find(ch => ch.id === channelId || ch.name === channelId);
    if (!channel) {
      channel = {
        id: channelId,
        name: channelId,
        status: 'pending',
        messages: 0
      };
      state.channels.push(channel);
    }
    return channel;
  }

  private formatTimestamp(iso: string): string {
    const date = new Date(iso);
    return date.toISOString().replace('T', ' ').split('.')[0];
  }
}

let slackLoggerInstance: SlackProgressLogger | null = null;

export function getSlackLogger(): SlackProgressLogger {
  if (!slackLoggerInstance) {
    slackLoggerInstance = new SlackProgressLogger();
  }
  return slackLoggerInstance;
}

export function resetSlackLogger(): void {
  if (slackLoggerInstance) {
    slackLoggerInstance.stop();
  }
  slackLoggerInstance = null;
}

