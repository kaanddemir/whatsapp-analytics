// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Chart } from "chart.js";
import { applyChartTheme } from "@/ui/charts/ChartCanvas";
import { readChartTheme, useChartTheme, type ChartTheme } from "@/ui/charts/chartTheme";

const css = readFileSync("src/ui/styles.css", "utf8");
const root = document.documentElement;

function setTokens(series: string) {
  root.style.setProperty("--color-chart-series", series);
}

afterEach(() => {
  cleanup();
  root.removeAttribute("data-theme");
  root.style.removeProperty("--color-chart-series");
});

describe("chart tokens", () => {
  it("defines every chart token in both themes", () => {
    const [light, dark] = [css.split(':root[data-theme="dark"]')[0]!, css.split(':root[data-theme="dark"]')[1]!.split("}")[0]!];
    for (const token of ["--color-chart-series", "--color-chart-fill", "--color-chart-bar", "--color-chart-bar-peak", "--color-chart-grid", "--color-chart-axis", "--color-tooltip"]) {
      expect(light, token).toContain(`${token}:`);
      expect(dark, token).toContain(`${token}:`);
    }
  });

  it("chart code holds no colour literals", () => {
    for (const file of ["src/ui/charts/ChartCanvas.tsx", "src/ui/components/TimelineCard.tsx", "src/ui/components/TimingCards.tsx", "src/ui/charts/Sparkline.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });

  it("reads the active theme's values and re-reads after a theme change", () => {
    root.dataset.theme = "light";
    setTokens("#168568");
    expect(readChartTheme().series).toBe("#168568");
    setTokens("#4bc49a");
    root.dataset.theme = "dark";
    expect(readChartTheme().series).toBe("#4bc49a");
  });

  it("re-renders subscribers when data-theme changes", async () => {
    root.dataset.theme = "light";
    setTokens("#168568");
    function Probe() {
      return <p>{useChartTheme().series}</p>;
    }
    render(<Probe />);
    expect(screen.getByText("#168568")).toBeTruthy();
    await act(async () => {
      setTokens("#4bc49a");
      root.dataset.theme = "dark";
      await Promise.resolve();
    });
    expect(screen.getByText("#4bc49a")).toBeTruthy();
  });
});

describe("applyChartTheme", () => {
  it("repaints datasets, axes and tooltip in place", () => {
    const chart = {
      data: { datasets: [{ data: [1, 2] }] },
      options: { scales: { x: { ticks: {}, grid: {}, border: {} }, y: { ticks: {}, grid: {}, title: { text: "Messages" } } }, plugins: { tooltip: {} } },
    } as unknown as Chart<"line">;
    const theme = { ...readChartTheme(), series: "S", muted: "M", grid: "G", tooltip: "T", tooltipText: "TT" } as ChartTheme;
    applyChartTheme(chart, theme, (t) => [{ borderColor: t.series }]);
    const o = chart.options as unknown as Record<string, any>;
    expect((chart.data.datasets[0] as unknown as Record<string, unknown>).borderColor).toBe("S");
    expect(chart.data.datasets[0]!.data).toEqual([1, 2]);
    expect(o.scales.x.ticks.color).toBe("M");
    expect(o.scales.y.title.color).toBe("M");
    expect(o.scales.x.grid.color).toBe("G");
    expect(o.plugins.tooltip.backgroundColor).toBe("T");
    expect(o.plugins.tooltip.bodyColor).toBe("TT");
  });
});
