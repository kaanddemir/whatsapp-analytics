// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ChartConfiguration } from "chart.js";
import { I18nProvider } from "@/ui/i18n";
import { LanguageSelector } from "@/ui/components/LanguageSelector";
import { ChartCanvas } from "@/ui/charts/ChartCanvas";

const state = vi.hoisted(() => ({ charts: [] as { options: Record<string, any>; data: any; destroyed: boolean }[] }));
vi.mock("chart.js", async (original) => ({
  ...await original<typeof import("chart.js")>(),
  Chart: class {
    static register() {}
    options: Record<string, any>; data: any; destroyed = false;
    constructor(_canvas: unknown, config: ChartConfiguration) {
      this.options = config.options ?? {}; this.data = config.data; state.charts.push(this);
    }
    update() {} destroy() { this.destroyed = true; }
  },
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("updates Chart.js numeric tick locale when the language changes with the same data", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
  const config: ChartConfiguration<"line"> = { type: "line", data: { labels: ["A"], datasets: [{ data: [1234.5] }] }, options: { scales: { y: { ticks: {} } } } };
  render(<I18nProvider initialLocale="en"><LanguageSelector /><ChartCanvas config={config} paint={() => []} summary="Chart" /></I18nProvider>);
  const first = state.charts.at(-1)!;
  expect(new Intl.NumberFormat(first.options.locale).format(1234.5)).toBe("1,234.5");
  fireEvent.click(screen.getByRole("button", { name: "Türkçe" }));
  expect(first.destroyed).toBe(true);
  expect(new Intl.NumberFormat(state.charts.at(-1)!.options.locale).format(1234.5)).toBe("1.234,5");
});
