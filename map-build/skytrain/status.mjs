// The skytrain's two looks, shared by add-skytrain.mjs (which builds the network) and set-status.mjs (which
// flips an existing map between them). "open": the network as built in map build 5. "proposed": nothing
// built yet, every stop and route a proposal (map build 7, for the players' test flight).

export const MODES = ["open", "proposed"];

// route-group styles (map units)
export const STYLE = {
  open: {
    skytrain: { opacity: 0.85, stroke: "#9ff3ff", "stroke-width": 0.8, "stroke-dasharray": "", "stroke-linecap": "round" },
    skytrainLocal: { opacity: 0.85, stroke: "#9ff3ff", "stroke-width": 0.5, "stroke-dasharray": "", "stroke-linecap": "round" },
    skytrainBuilding: { opacity: 0.55, stroke: "#9ff3ff", "stroke-width": 0.5, "stroke-dasharray": "2.5 2", "stroke-linecap": "butt" },
  },
  // every line dashed; trunks keep their extra weight so the network still reads
  proposed: {
    skytrain: { opacity: 0.85, stroke: "#9ff3ff", "stroke-width": 0.8, "stroke-dasharray": "3 2", "stroke-linecap": "butt" },
    skytrainLocal: { opacity: 0.8, stroke: "#9ff3ff", "stroke-width": 0.5, "stroke-dasharray": "2.5 2", "stroke-linecap": "butt" },
    skytrainBuilding: { opacity: 0.8, stroke: "#9ff3ff", "stroke-width": 0.5, "stroke-dasharray": "2.5 2", "stroke-linecap": "butt" },
  },
};

const ICON = {
  open: { hub: "🚉", major: "🚝", local: "🚝", planned: "🚧", "planned-local": "🚧" },
  proposed: { hub: "🚉", major: "🚧", local: "🚧", planned: "🚧", "planned-local": "🚧" },
};
export const SIZE = { hub: 34, major: 26, local: 18, planned: 22, "planned-local": 16 };

// marker icon + note for one station of skytrain.json
export function stationMarker(s, mode) {
  const icon = ICON[mode][s.role];
  if (mode === "proposed") {
    const to = s.links.map((l) => l.to).join(", ");
    const name = s.role === "hub" ? `${s.name} — Skytrain Central (proposed)` : `${s.name} Skytrain Station (proposed)`;
    const legend = (s.role === "hub"
      ? "The proposed hub of Turgythe's skytrain network. Nothing is built yet: every stop and route is still up for decision. "
      : "A proposed stop on Turgythe's skytrain network. ") + `Proposed lines to ${to}.`;
    return { icon, name, legend };
  }
  const open = s.links.filter((l) => l.status === "open").map((l) => l.to);
  const building = s.links.filter((l) => l.status !== "open").map((l) => l.to);
  const planned = s.role.startsWith("planned");
  const name = s.role === "hub" ? `${s.name} — Skytrain Central` : `${s.name} Skytrain ${planned ? "Station (under construction)" : "Station"}`;
  let legend = s.role === "hub"
    ? "The heart of Turgythe's skytrain network, ten years in the building and still growing. "
    : planned ? "A station still under construction on the expanding skytrain network. " : "";
  if (open.length) legend += `Lines to ${open.join(", ")}. `;
  if (building.length) legend += `Under construction: ${building.join(", ")}.`;
  return { icon, name, legend: legend.trim() };
}
