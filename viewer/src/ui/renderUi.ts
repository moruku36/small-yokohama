import type { PortCallRecord } from "@small-yokohama/core";
import type { LoadedReleaseBundle } from "../data/releaseLoader.js";
import type { ResolvedFeedState } from "../data/vehicleFeed.js";
import { getDict } from "../i18n.js";
import type { FeedPreset, MapVariant, ViewerState } from "../state.js";

export interface UiHandlers {
  onToggleDrawer: () => void;
  onChangeVariant: (v: MapVariant) => void;
  onChangeFeed: (f: FeedPreset) => void;
  onChangeSunHour: (hour: number | null) => void;
  onTogglePlay: () => void;
  onResetView: () => void;
  onShare: () => Promise<boolean>;
  onToggleLang: () => void;
  onOpenCredits: () => void;
  onCloseCredits: () => void;
  onToggleOption: (
    key:
      | "showDepthMap"
      | "xrayOcclusion"
      | "showTileGrid"
      | "showGcps"
      | "showDeckTestPoint"
      | "reducedMotion",
  ) => void;
  onSelectLandmarkId: (id: string) => void;
  onSelectPortCall: (pc: PortCallRecord) => void;
  onClearSelection: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderTopBar(
  el: HTMLElement,
  state: ViewerState,
  handlers: UiHandlers,
): void {
  const d = getDict(state.lang);
  const sunValue = state.sunHourJst === null ? "live" : String(state.sunHourJst);

  el.innerHTML = `
    <div class="brand">
      <button class="btn" id="btn-drawer">${escapeHtml(d.drawerToggle)}</button>
      <span class="brand-title">${escapeHtml(d.appTitle)}</span>
      <span class="proxy-pill">${escapeHtml(d.proxyTag)}</span>
    </div>
    <div class="controls-row">
      <div class="ctrl-group">
        <label for="sel-variant">${escapeHtml(d.variantLabel)}</label>
        <select id="sel-variant" class="ctrl-select">
          <option value="illustrated" ${state.variant === "illustrated" ? "selected" : ""}>${escapeHtml(d.variantIllustrated)}</option>
          <option value="plain" ${state.variant === "plain" ? "selected" : ""}>${escapeHtml(d.variantPlain)}</option>
        </select>
      </div>
      <div class="ctrl-group">
        <label for="sel-feed">${escapeHtml(d.feedLabel)}</label>
        <select id="sel-feed" class="ctrl-select">
          ${(Object.keys(d.feedOptions) as FeedPreset[])
            .map(
              (k) =>
                `<option value="${k}" ${state.feedPreset === k ? "selected" : ""}>${escapeHtml(d.feedOptions[k])}</option>`,
            )
            .join("")}
        </select>
      </div>
      <div class="ctrl-group">
        <label for="sel-sun">${escapeHtml(d.sunLabel)}</label>
        <select id="sel-sun" class="ctrl-select">
          <option value="live" ${sunValue === "live" ? "selected" : ""}>${escapeHtml(d.sunRealtime)}</option>
          <option value="9.5" ${sunValue === "9.5" ? "selected" : ""}>09:30 JST</option>
          <option value="15.5" ${sunValue === "15.5" ? "selected" : ""}>15:30 JST</option>
          <option value="17.25" ${sunValue === "17.25" ? "selected" : ""}>17:15 JST (Sunset)</option>
          <option value="20" ${sunValue === "20" ? "selected" : ""}>20:00 JST (Night)</option>
        </select>
      </div>
      <button class="btn ${state.playing ? "active" : ""}" id="btn-play">${escapeHtml(state.playing ? d.pauseBtn : d.playBtn)}</button>
      <button class="btn" id="btn-reset">${escapeHtml(d.resetViewBtn)}</button>
      <button class="btn" id="btn-share">${escapeHtml(d.shareBtn)}</button>
      <button class="btn" id="btn-lang">${escapeHtml(d.langBtn)}</button>
      <button class="btn" id="btn-credits">${escapeHtml(d.creditsBtn)}</button>
    </div>
  `;

  el.querySelector("#btn-drawer")?.addEventListener("click", handlers.onToggleDrawer);
  el.querySelector("#sel-variant")?.addEventListener("change", (e) => {
    handlers.onChangeVariant((e.target as HTMLSelectElement).value as MapVariant);
  });
  el.querySelector("#sel-feed")?.addEventListener("change", (e) => {
    handlers.onChangeFeed((e.target as HTMLSelectElement).value as FeedPreset);
  });
  el.querySelector("#sel-sun")?.addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value;
    handlers.onChangeSunHour(val === "live" ? null : Number(val));
  });
  el.querySelector("#btn-play")?.addEventListener("click", handlers.onTogglePlay);
  el.querySelector("#btn-reset")?.addEventListener("click", handlers.onResetView);
  el.querySelector("#btn-share")?.addEventListener("click", async () => {
    const ok = await handlers.onShare();
    const btn = el.querySelector("#btn-share");
    if (ok && btn) {
      btn.textContent = d.shareCopied;
      setTimeout(() => {
        btn.textContent = d.shareBtn;
      }, 1600);
    }
  });
  el.querySelector("#btn-lang")?.addEventListener("click", handlers.onToggleLang);
  el.querySelector("#btn-credits")?.addEventListener("click", handlers.onOpenCredits);
}

export function renderFeedBanner(
  el: HTMLElement,
  state: ViewerState,
  feed: ResolvedFeedState | null,
): void {
  if (!feed) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const cls =
    feed.feedHealth === "outage"
      ? "outage"
      : feed.feedHealth === "no_match" || feed.feedHealth === "no_service"
        ? "warn"
        : "ok";
  el.className = `feed-banner ${cls}`;
  const msg = state.lang === "en" ? feed.messageEn : feed.messageJa;
  const src = state.lang === "en" ? feed.sourceLabelEn : feed.sourceLabelJa;
  el.innerHTML = `
    <span><strong>[${escapeHtml(feed.feedHealth.toUpperCase())}]</strong> ${escapeHtml(msg)}</span>
    <span>${escapeHtml(src)} · ${escapeHtml(feed.fetchedAt)}</span>
  `;
}

export function renderDrawer(
  el: HTMLElement,
  state: ViewerState,
  bundle: LoadedReleaseBundle,
  feed: ResolvedFeedState | null,
  handlers: UiHandlers,
): void {
  const d = getDict(state.lang);
  el.classList.toggle("collapsed", !state.drawerOpen);

  const selectedLmId =
    state.selected?.kind === "landmark" ? state.selected.landmark.id : null;

  const toggleRow = (
    key:
      | "showDepthMap"
      | "xrayOcclusion"
      | "showTileGrid"
      | "showGcps"
      | "showDeckTestPoint"
      | "reducedMotion",
    label: string,
    checked: boolean,
  ) => `
    <label class="toggle-row">
      <span>${escapeHtml(label)}</span>
      <input type="checkbox" data-opt="${key}" ${checked ? "checked" : ""} />
    </label>
  `;

  const portCalls = feed?.portCalls ?? [];

  el.innerHTML = `
    <h2 class="drawer-section-title">${escapeHtml(d.layersHeading)}</h2>
    <div class="layer-toggles">
      ${toggleRow("showDepthMap", d.toggleDepth, state.showDepthMap)}
      ${toggleRow("xrayOcclusion", d.toggleXray, state.xrayOcclusion)}
      ${toggleRow("showTileGrid", d.toggleTileGrid, state.showTileGrid)}
      ${toggleRow("showGcps", d.toggleGcps, state.showGcps)}
      ${toggleRow("showDeckTestPoint", d.toggleDeckPoint, state.showDeckTestPoint)}
      ${toggleRow("reducedMotion", d.toggleReducedMotion, state.reducedMotion)}
    </div>

    <h2 class="drawer-section-title">${escapeHtml(d.landmarksHeading)}</h2>
    <ul class="landmark-list">
      ${bundle.landmarks
        .map(
          (lm) => `
        <li>
          <button
            class="landmark-item-btn ${selectedLmId === lm.id ? "selected" : ""}"
            data-landmark-id="${escapeHtml(lm.id)}"
          >
            <span class="landmark-name">${escapeHtml(state.lang === "en" ? lm.nameEn : lm.nameJa)}</span>
            <span class="landmark-meta">${escapeHtml(lm.category)} · ${lm.elevationM.toFixed(1)}m</span>
          </button>
        </li>`,
        )
        .join("")}
    </ul>

    <h2 class="drawer-section-title">${escapeHtml(d.portCallsHeading)}</h2>
    <ul class="landmark-list">
      ${portCalls
        .map(
          (pc) => `
        <li>
          <button class="landmark-item-btn" data-portcall-id="${escapeHtml(pc.id)}">
            <span class="landmark-name">${escapeHtml(state.lang === "en" ? pc.vesselNameEn : pc.vesselNameJa)}</span>
            <span class="landmark-meta">${escapeHtml(state.lang === "en" ? pc.berthEn : pc.berthJa)}</span>
          </button>
        </li>`,
        )
        .join("")}
    </ul>
  `;

  el.querySelectorAll<HTMLInputElement>("input[data-opt]").forEach((input) => {
    input.addEventListener("change", () => {
      const opt = input.dataset.opt as Parameters<UiHandlers["onToggleOption"]>[0];
      handlers.onToggleOption(opt);
    });
  });

  el.querySelectorAll<HTMLButtonElement>("button[data-landmark-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.landmarkId;
      if (id) handlers.onSelectLandmarkId(id);
    });
  });

  el.querySelectorAll<HTMLButtonElement>("button[data-portcall-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pc = portCalls.find((p) => p.id === btn.dataset.portcallId);
      if (pc) handlers.onSelectPortCall(pc);
    });
  });
}

export function renderDetailCard(
  el: HTMLElement,
  state: ViewerState,
  feed: ResolvedFeedState | null,
  driftCssPx: number,
  handlers: UiHandlers,
): void {
  const d = getDict(state.lang);
  const sel = state.selected;
  if (!sel) {
    el.hidden = true;
    return;
  }
  el.hidden = false;

  if (sel.kind === "vehicle") {
    const liveMatch = feed?.vehicles.find((rv) => rv.record.entityId === sel.vehicle.entityId);
    const v = liveMatch?.record ?? sel.vehicle;
    const displayMode = liveMatch?.displayMode ?? sel.vehicle.mode;
    const ageSec = liveMatch?.freshness.ageSec ?? sel.ageSec;
    const badgeLabel = d.modeLabels[displayMode];
    const note = state.lang === "en" ? liveMatch?.noteEn : liveMatch?.noteJa;

    el.innerHTML = `
      <div class="detail-header">
        <div>
          <h3 class="detail-title">${escapeHtml(state.lang === "en" ? v.routeLabelEn : v.routeLabelJa)}</h3>
          <span class="mode-badge ${escapeHtml(displayMode)}">${escapeHtml(badgeLabel)}</span>
        </div>
        <button class="btn" id="btn-close-detail">${escapeHtml(d.closeBtn)}</button>
      </div>
      ${note ? `<p style="margin:4px 0 6px;color:#bde3f7;">${escapeHtml(note)}</p>` : ""}
      <dl class="detail-grid">
        <dt>${escapeHtml(d.fields.direction)}</dt>
        <dd>${escapeHtml(state.lang === "en" ? v.directionLabelEn : v.directionLabelJa)}</dd>
        <dt>${escapeHtml(d.fields.deck)}</dt>
        <dd>${escapeHtml(v.deckId)} (+${v.roadElevationM.toFixed(1)}m)</dd>
        <dt>${escapeHtml(d.fields.observedAt)}</dt>
        <dd>${escapeHtml(v.observedAt ?? "null")}</dd>
        <dt>${escapeHtml(d.fields.age)}</dt>
        <dd>${ageSec === null ? "n/a" : `${Math.round(ageSec)}s`}</dd>
        <dt>${escapeHtml(d.fields.fetchedAt)}</dt>
        <dd>${escapeHtml(v.fetchedAt)}</dd>
        <dt>${escapeHtml(d.fields.drift)}</dt>
        <dd>${driftCssPx.toFixed(3)} CSS px</dd>
      </dl>
    `;
  } else if (sel.kind === "landmark") {
    const lm = sel.landmark;
    el.innerHTML = `
      <div class="detail-header">
        <div>
          <h3 class="detail-title">${escapeHtml(state.lang === "en" ? lm.nameEn : lm.nameJa)}</h3>
          <span class="mode-badge scheduled">${escapeHtml(lm.sourceKind)}</span>
        </div>
        <button class="btn" id="btn-close-detail">${escapeHtml(d.closeBtn)}</button>
      </div>
      <p style="margin:4px 0 8px;">${escapeHtml(state.lang === "en" ? lm.descriptionEn : lm.descriptionJa)}</p>
      <dl class="detail-grid">
        <dt>${escapeHtml(d.fields.coordinates)}</dt>
        <dd>${lm.lat.toFixed(5)}, ${lm.lon.toFixed(5)} (+${lm.elevationM.toFixed(1)}m)</dd>
        <dt>${escapeHtml(d.fields.drift)}</dt>
        <dd>${driftCssPx.toFixed(3)} CSS px</dd>
      </dl>
    `;
  } else {
    const pc = sel.portCall;
    el.innerHTML = `
      <div class="detail-header">
        <div>
          <h3 class="detail-title">${escapeHtml(state.lang === "en" ? pc.vesselNameEn : pc.vesselNameJa)}</h3>
          <span class="mode-badge scheduled">${escapeHtml(d.modeLabels.scheduled)}</span>
        </div>
        <button class="btn" id="btn-close-detail">${escapeHtml(d.closeBtn)}</button>
      </div>
      <dl class="detail-grid">
        <dt>${escapeHtml(d.fields.berth)}</dt>
        <dd>${escapeHtml(state.lang === "en" ? pc.berthEn : pc.berthJa)}</dd>
        <dt>${escapeHtml(d.fields.schedule)}</dt>
        <dd>${escapeHtml(pc.arrivalTime)} → ${escapeHtml(pc.departureTime)}</dd>
        <dt>${escapeHtml(d.fields.source)}</dt>
        <dd>${escapeHtml(pc.source)}</dd>
      </dl>
    `;
  }

  el.querySelector("#btn-close-detail")?.addEventListener("click", handlers.onClearSelection);
}

export function renderCreditsBarAndModal(
  barEl: HTMLElement,
  modalEl: HTMLElement,
  state: ViewerState,
  bundle: LoadedReleaseBundle,
  modalOpen: boolean,
  handlers: UiHandlers,
): void {
  const d = getDict(state.lang);
  const notice = state.lang === "en" ? bundle.release.sceneNotice.en : bundle.release.sceneNotice.ja;
  barEl.innerHTML = `
    <span>${escapeHtml(notice)}</span>
    <span>
      ${bundle.release.credits.map((c) => escapeHtml(c.attributionText)).join(" · ")}
    </span>
  `;

  modalEl.hidden = !modalOpen;
  if (!modalOpen) return;

  const qa = bundle.qaReport;
  modalEl.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(d.creditsTitle)}">
      <div class="detail-header">
        <h2 style="margin:0;font-size:16px;">${escapeHtml(d.creditsTitle)}</h2>
        <button class="btn" id="btn-close-credits">${escapeHtml(d.closeBtn)}</button>
      </div>
      <p style="color:var(--text-muted);">${escapeHtml(notice)}</p>
      <h3 style="margin:12px 0 6px;font-size:13px;">${escapeHtml(d.qaSummary)} (${qa.releaseId})</h3>
      <p style="font-family:var(--font-mono);font-size:12px;margin:0 0 10px;">
        passed=${qa.passed} | GCPs=${qa.gcpChecks.length} | maxDisp=${qa.maxGcpDisplacementPx} px (&le; ${qa.gcpThresholdPx} px) |
        waterInventedBuildings=${qa.waterIntegrity.inventedBuildingPixels} |
        depthBytes=${qa.metrics.depthBytes} B
      </p>
      ${bundle.release.credits
        .map(
          (c) => `
        <div class="credit-row">
          <strong>${escapeHtml(c.dataset)}</strong> — ${escapeHtml(c.publisher)} (${escapeHtml(c.license)})<br />
          <small style="color:var(--text-muted);">
            Version: ${escapeHtml(c.version)} · Retrieved: ${escapeHtml(c.retrievedAt)}<br />
            ${escapeHtml(c.modifications)}
          </small>
        </div>`,
        )
        .join("")}
    </div>
  `;

  modalEl.querySelector("#btn-close-credits")?.addEventListener("click", handlers.onCloseCredits);
  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) handlers.onCloseCredits();
  });
}
