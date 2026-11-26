import {
  formatBuildingType,
  formatCategory,
  formatSurfaceKind,
  getDict,
  type Lang,
} from "../i18n.js";
import type { MapPick } from "../viewer/MapViewer.js";

/**
 * Desktop hover: a small paper tag by the cursor naming whatever is under it — a bus and
 * where it is heading, a train and its next stop, a ship, a landmark or a building — so the
 * map can be read without clicking everything.
 */

export interface TipText {
  title: string;
  sub: string;
}

export function describePick(pick: MapPick, lang: Lang): TipText {
  const en = lang === "en";
  const d = getDict(lang);
  switch (pick.kind) {
    case "vehicle": {
      const v = pick.vehicle.record;
      return {
        title: en ? v.routeLabelEn : v.routeLabelJa,
        sub: en ? v.directionLabelEn : v.directionLabelJa,
      };
    }
    case "train": {
      const tr = pick.train;
      const next = en ? tr.nextStopEn : tr.nextStopJa;
      return {
        title: `${tr.code} ${en ? tr.lineNameEn : tr.lineNameJa}`,
        sub: next ? (en ? `Next: ${next}` : `次は ${next}`) : en ? tr.directionEn : tr.directionJa,
      };
    }
    case "plane": {
      const p = pick.plane;
      return {
        title: `${p.callsign} (${en ? p.airlineEn : p.airlineJa})`,
        sub: `${d.planeKinds[p.meshKind]} · ${p.altitudeM.toLocaleString()} m · ${Math.round(p.groundSpeedKmh)} km/h`,
      };
    }
    case "aircabin": {
      const c = pick.cabin;
      return {
        title: `${d.airCabinName} #${c.cabinNumber}`,
        sub: `${en ? c.directionEn : c.directionJa} · ${Math.round(c.cableElevM)} m`,
      };
    }
    case "portcall": {
      const pc = pick.portCall;
      const kind = d.vesselKinds[pc.vesselKind ?? "cruise"];
      const state = pc.moving !== false ? d.underwayLabel : d.berthedLabel;
      return { title: en ? pc.vesselNameEn : pc.vesselNameJa, sub: `${kind} · ${state}` };
    }
    case "landmark": {
      const lm = pick.landmark;
      return { title: en ? lm.nameEn : lm.nameJa, sub: formatCategory(lm.category, lang) };
    }
    case "feature": {
      const f = pick.feature;
      const name = (en ? f.nameEn : f.nameJa) || "";
      const kind = f.buildingType
        ? formatBuildingType(f.buildingType, lang)
        : formatSurfaceKind(f.surfaceKind, lang);
      const parts: string[] = [];
      if (name) parts.push(kind);
      if (f.heightM > 0) parts.push(`${f.heightM.toFixed(0)} m`);
      if (f.levels) parts.push(en ? `${f.levels}F` : `${f.levels}階`);
      if (f.yearBuilt) parts.push(f.yearBuilt);
      const sub = parts.join(" · ");
      return name ? { title: name, sub } : { title: kind, sub };
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export class HoverTip {
  private readonly el: HTMLDivElement;
  private lastHtml = "";

  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement("div");
    this.el.className = "tip";
    this.el.setAttribute("role", "tooltip");
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  show(text: TipText, clientX: number, clientY: number): void {
    const html = `<b>${escapeHtml(text.title)}</b>${text.sub ? `<span>${escapeHtml(text.sub)}</span>` : ""}`;
    if (html !== this.lastHtml) {
      this.el.innerHTML = html;
      this.lastHtml = html;
    }
    this.el.hidden = false;
    // beside the cursor, flipped to stay on screen
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let x = clientX + 14;
    let y = clientY + 16;
    if (x + w > window.innerWidth - 8) x = clientX - 14 - w;
    if (y + h > window.innerHeight - 8) y = clientY - 12 - h;
    this.el.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(Math.max(8, y))}px)`;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
