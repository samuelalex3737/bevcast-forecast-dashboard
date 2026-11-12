"use client";

import { useMemo } from "react";
import katex from "katex";

const FORMULAS: { name: string; tex: string; note: string }[] = [
  { name: "MAPE", tex: "\\mathrm{MAPE} = \\frac{100}{m} \\sum_{t:\\,A_t \\neq 0} \\frac{|A_t - F_t|}{|A_t|}", note: "Average percentage error per month. Months with zero actual sales are skipped (and counted) because a percentage of zero cannot be computed." },
  { name: "WAPE", tex: "\\mathrm{WAPE} = 100 \\cdot \\frac{\\sum_t |A_t - F_t|}{\\sum_t |A_t|}", note: "Total absolute error as a share of total volume. Weights big months more, matches how production cost scales, and stays defined with zeros. Primary ranking metric." },
  { name: "Bias", tex: "\\mathrm{Bias\\%} = 100 \\cdot \\frac{\\sum_t (F_t - A_t)}{\\sum_t A_t}", note: "Positive means systematic over-forecasting (excess stock), negative means under-forecasting (stock-outs)." },
  { name: "RMSE / MAE", tex: "\\mathrm{RMSE} = \\sqrt{\\tfrac{1}{m}\\sum_t (A_t - F_t)^2}, \\quad \\mathrm{MAE} = \\tfrac{1}{m}\\sum_t |A_t - F_t|", note: "Errors in units; RMSE penalises large misses more." },
  { name: "MASE", tex: "\\mathrm{MASE} = \\frac{\\mathrm{MAE}}{\\frac{1}{n-1}\\sum_{t=2}^{n} |y_t - y_{t-1}|}", note: "Scaled by the in-sample naive error: below 1 beats a naive forecast on the training data." },
  { name: "Interval", tex: "\\hat{y}_{T+h} \\pm z_{\\alpha} \\, \\sigma \\sqrt{h}, \\quad \\sigma = \\sqrt{\\tfrac{1}{k}\\sum e_{\\text{wf}}^2}", note: "sigma is the root-mean-square of one-step walk-forward residuals; bounds are floored at zero." },
  { name: "Safety stock", tex: "SS_h = z_{\\text{service}} \\, \\sigma \\sqrt{h}, \\quad Q_h = \\lceil (\\hat{y}_{T+h} + SS_h)/100 \\rceil \\cdot 100", note: "One-sided z for the chosen service level (90% 1.28, 95% 1.64, 97.5% 1.96, 99% 2.33)." },
  { name: "Cost of error", tex: "C = c \\sum_t (F_t - A_t)^+ + (p - c) \\sum_t (A_t - F_t)^+", note: "Over-forecast units waste the unit cost c; under-forecast units lose the margin p - c." },
  { name: "Growth target", tex: "g_t = \\ln(y_t + 1) - \\ln(y_{t-1} + 1), \\quad \\hat{y}_{t} = e^{\\ln(\\hat{y}_{t-1}+1) + \\hat{g}_t} - 1", note: "Random Forest and Gradient Boosting predict log growth and compound it, so they can extrapolate beyond past volumes." },
  { name: "AICc (ARIMA)", tex: "\\mathrm{AICc} = m \\ln\\!\\left(\\tfrac{\\mathrm{SSE}}{m}\\right) + 2k + \\frac{2k(k+1)}{m-k-1}", note: "Computed on the same effective sample for every (p, q); the small-sample correction penalises extra parameters." },
  { name: "Holt (damped)", tex: "\\ell_t = \\alpha y_t + (1-\\alpha)(\\ell_{t-1} + \\phi b_{t-1}), \\quad b_t = \\beta(\\ell_t - \\ell_{t-1}) + (1-\\beta)\\phi b_{t-1}", note: "Forecast: level plus (phi + phi^2 + ... + phi^h) times trend; alpha, beta, phi by grid search." },
  { name: "XGBoost gain", tex: "\\mathrm{Gain} = \\tfrac{1}{2}\\left[\\frac{G_L^2}{H_L+\\lambda} + \\frac{G_R^2}{H_R+\\lambda} - \\frac{G^2}{H+\\lambda}\\right] - \\gamma, \\quad w^* = -\\frac{G}{H+\\lambda}", note: "Second-order split gain with L2 leaf regularisation (lambda = 1, gamma = 0)." },
];

export function Formulas() {
  const rendered = useMemo(
    () =>
      FORMULAS.map((f) => {
        let html = "";
        try {
          html = katex.renderToString(f.tex, { throwOnError: false, displayMode: true, output: "htmlAndMathml" });
        } catch {
          html = "";
        }
        return { ...f, html };
      }),
    [],
  );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rendered.map((f) => (
        <div key={f.name} className="rounded-lg border p-3">
          <p className="text-[13px] font-semibold">{f.name}</p>
          {f.html ? <div className="overflow-x-auto py-1 text-[14px]" dangerouslySetInnerHTML={{ __html: f.html }} /> : <code className="block py-2 text-xs">{f.tex}</code>}
          <p className="text-[12.5px] text-muted-foreground">{f.note}</p>
        </div>
      ))}
    </div>
  );
}
