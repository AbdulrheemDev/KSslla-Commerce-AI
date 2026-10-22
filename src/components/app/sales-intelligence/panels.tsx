import type { Metric } from "@/modules/intelligence/domain/types";
import {
  SEVERITY_LABELS_AR,
  SEVERITY_TONES,
  formatMoney,
  formatNumber,
  reasonLabel,
} from "@/components/app/intelligence/panels";
import type { AnomalyReport, SalesAnomaly } from "@/modules/sales-intelligence/domain/anomalies";
import type { SalesAlert } from "@/modules/sales-intelligence/domain/alerts";
import type { DiscountAnalysis } from "@/modules/sales-intelligence/domain/discounts";
import type { LeakageReport } from "@/modules/sales-intelligence/domain/leakage";
import {
  WEEKDAY_LABELS_AR,
  type SeasonalityAnalysis,
} from "@/modules/sales-intelligence/domain/seasonality";
import type { SalesDataConfidence } from "@/modules/sales-intelligence/application/sales-intelligence-service";
import type { TrendBucket } from "@/modules/sales-intelligence/domain/trends";

/**
 * Presentation for the sales-intelligence page.
 *
 * Charts are drawn from the API's own buckets: a point exists only when the
 * bucket has a value, and a gap is rendered as a gap. There is no smoothing, no
 * interpolation, and no placeholder series — a chart that looks continuous must
 * mean the data is continuous.
 */

/** Evidence values are `string | number | null`; render each without coercion. */
function evidenceValue(value: string | number | null): string {
  if (value === null) return "—";
  return typeof value === "number" ? formatNumber(value) : value;
}

const CHART_WIDTH = 600;
const CHART_HEIGHT = 150;

function seriesValues(buckets: readonly TrendBucket[], pick: ChartMetric): Array<number | null> {
  return buckets.map((bucket) => bucket[pick].value);
}

type ChartMetric = "revenue" | "orders" | "averageOrderValue";

function runsOf(values: ReadonlyArray<number | null>): Array<Array<{ x: number; y: number }>> {
  const runs: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];

  for (const [index, value] of values.entries()) {
    if (value === null) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }

    const x = values.length === 1 ? 0 : index / (values.length - 1);
    current.push({ x, y: value });
  }

  if (current.length > 0) runs.push(current);
  return runs;
}

function toPoints(run: Array<{ x: number; y: number }>, max: number): string {
  return run
    .map(({ x, y }) => {
      const px = 8 + x * (CHART_WIDTH - 16);
      const py = CHART_HEIGHT - 16 - (max === 0 ? 0 : (y / max) * (CHART_HEIGHT - 32));
      return `${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(" ");
}

/** One metric line, with the previous window as a dashed reference. */
export function TrendChart({
  title,
  hint,
  buckets,
  previous,
  pick,
  unit,
  currency = null,
}: {
  title: string;
  hint?: string;
  buckets: readonly TrendBucket[];
  previous: readonly TrendBucket[] | null;
  pick: ChartMetric;
  unit: "money" | "number";
  currency?: string | null;
}) {
  const values = seriesValues(buckets, pick);
  const previousValues = previous ? seriesValues(previous, pick) : [];
  const all = [...values, ...previousValues].filter((value): value is number => value !== null);

  const format = (value: number | null) =>
    unit === "money" ? formatMoney(value, currency) : formatNumber(value);

  const max = all.length > 0 ? Math.max(...all) : 0;
  const currentRuns = runsOf(values);
  const previousRuns = runsOf(previousValues);
  const hasPoints = all.length > 0;

  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));
  const labelIndexes = buckets
    .map((_, index) => index)
    .filter((index) => index % labelEvery === 0 || index === buckets.length - 1);

  return (
    <figure className="rounded-2xl border border-line bg-surface/60 p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink">{title}</h3>
        <div className="flex items-center gap-3 text-[10px] text-muted">
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-teal" />
            الفترة الحالية
          </span>
          {previous ? (
            <span className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-4 border-t border-dashed border-muted"
              />
              الفترة السابقة
            </span>
          ) : null}
        </div>
      </figcaption>

      {!hasPoints ? (
        <p className="mt-4 rounded-xl border border-dashed border-line px-3 py-6 text-center text-[11.5px] text-muted">
          لا توجد نقاط كافية للرسم في هذه الفترة — كل القيم غير متاحة أو غير محسوبة.
        </p>
      ) : (
        <div className="mt-3" dir="ltr">
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="h-auto w-full"
            role="img"
            aria-label={`${title}: ${buckets.length} نقطة، أقصى قيمة ${format(max)}`}
          >
            {[0, 0.5, 1].map((ratio) => {
              const y = 16 + ratio * (CHART_HEIGHT - 32);
              return (
                <g key={ratio}>
                  <line
                    x1={8}
                    x2={CHART_WIDTH - 8}
                    y1={y}
                    y2={y}
                    className="stroke-line"
                    strokeWidth={1}
                    strokeDasharray={ratio === 1 ? undefined : "3 4"}
                  />
                  <text x={8} y={y - 3} className="fill-muted text-[8px]">
                    {format(max * (1 - ratio))}
                  </text>
                </g>
              );
            })}

            {previousRuns.map((run, index) => (
              <polyline
                key={`previous-${index}`}
                points={toPoints(run, max)}
                fill="none"
                className="stroke-muted"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {currentRuns.map((run, index) => (
              <polyline
                key={`current-${index}`}
                points={toPoints(run, max)}
                fill="none"
                className="stroke-teal"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {values.map((value, index) => {
              if (value === null) return null;
              const x =
                8 + (values.length === 1 ? 0 : index / (values.length - 1)) * (CHART_WIDTH - 16);
              const y = CHART_HEIGHT - 16 - (max === 0 ? 0 : (value / max) * (CHART_HEIGHT - 32));

              return (
                <circle
                  key={buckets[index]?.key ?? index}
                  cx={x}
                  cy={y}
                  r={2.2}
                  className="fill-teal"
                >
                  <title>{`${buckets[index]?.key} — ${format(value)}`}</title>
                </circle>
              );
            })}
          </svg>
        </div>
      )}

      <div className="mt-2 flex justify-between text-[9.5px] text-muted" dir="ltr">
        {labelIndexes.map((index) => (
          <span key={index}>{buckets[index]?.key.slice(5)}</span>
        ))}
      </div>

      {hint ? <p className="mt-2 text-[10px] leading-5 text-muted">{hint}</p> : null}
      <p className="mt-1 text-[10px] leading-5 text-muted">
        النقاط الفارغة تعني «غير متاح» ولا تُرسم كصفر. الفترة السابقة تُقارن بالترتيب (نقطة بنقطة)
        لأن طول النافذتين متساوٍ.
      </p>
    </figure>
  );
}

/** The same series as a table, for screen readers and for exact numbers. */
export function TrendTable({
  buckets,
  currency,
}: {
  buckets: readonly TrendBucket[];
  currency: string | null;
}) {
  const rows = buckets.filter(
    (bucket) => bucket.orders.value !== null || bucket.revenue.value !== null,
  );

  if (rows.length === 0) return null;

  return (
    <details className="rounded-2xl border border-line bg-surface/40 p-4">
      <summary className="cursor-pointer text-[11.5px] font-medium text-ink">
        جدول القيم ({rows.length} نقطة)
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-start">
          <thead className="text-[10px] text-muted">
            <tr>
              <th className="py-1.5 text-start font-medium">الفترة</th>
              <th className="py-1.5 text-start font-medium">الطلبات</th>
              <th className="py-1.5 text-start font-medium">الإيراد</th>
              <th className="py-1.5 text-start font-medium">متوسط الطلب</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((bucket) => (
              <tr key={bucket.key} className="border-t border-line/60">
                <td className="py-1.5 text-[11px] ltr">{bucket.key}</td>
                <td className="py-1.5 text-[11px]">{formatNumber(bucket.orders.value)}</td>
                <td className="py-1.5 text-[11px]">
                  {formatMoney(bucket.revenue.value, currency)}
                </td>
                <td className="py-1.5 text-[11px]">
                  {formatMoney(bucket.averageOrderValue.value, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-muted">
        الخلايا الفارغة مكتوبة «—» لأن القيمة غير متاحة، وليست صفرًا.
      </p>
    </details>
  );
}

/** Data confidence: what the numbers are standing on. */
export function ConfidenceBanner({ confidence }: { confidence: SalesDataConfidence }) {
  const tone =
    confidence.level === "high"
      ? "border-teal/30 bg-teal/5 text-teal"
      : confidence.level === "medium"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-800"
        : "border-red-500/25 bg-red-500/5 text-red-700";

  const label =
    confidence.level === "high"
      ? "ثقة عالية"
      : confidence.level === "medium"
        ? "ثقة متوسطة"
        : "ثقة منخفضة";

  const facts = [
    confidence.ordersSynced ? "الطلبات مُزامنة" : "الطلبات لم تُزامَن",
    confidence.syncIncomplete ? "آخر مزامنة فاشلة" : null,
    confidence.baselineAvailable ? "فترة سابقة متاحة" : "لا فترة سابقة",
    confidence.mixedCurrency ? "عملات مختلطة — المال غير متاح" : null,
    confidence.historyStartsAfterWindow ? "السجل يبدأ بعد بداية الفترة" : null,
    confidence.coverageStatus === "complete"
      ? "تغطية كاملة"
      : confidence.coverageStatus === "partial"
        ? "تغطية جزئية"
        : "لا بيانات",
    confidence.staleResources.length > 0
      ? `بيانات متأخرة: ${confidence.staleResources.join(" · ")}`
      : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone}`}>
      <p className="text-[12px] font-semibold">{label}</p>
      <p className="mt-1 text-[10.5px] leading-5">{facts.join(" · ")}</p>
    </div>
  );
}

export function AnomalyCard({ anomaly }: { anomaly: SalesAnomaly }) {
  const unit = anomaly.unit === "percent" ? "%" : anomaly.unit === "points" ? " نقطة" : "";

  return (
    <article className="rounded-2xl border border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-md border px-2 py-0.5 text-[10.5px] font-semibold ${SEVERITY_TONES[anomaly.severity]}`}
        >
          {SEVERITY_LABELS_AR[anomaly.severity]}
        </span>
        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10.5px] text-muted">
          {anomaly.rationale}
        </span>
      </div>

      <h3 className="mt-2 text-[13px] font-semibold text-ink">{anomaly.title}</h3>
      <p className="mt-1 text-[11.5px] leading-6 text-muted">{anomaly.meaning}</p>

      <dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-3">
        <div>
          <dt className="text-muted">القيمة المرصودة</dt>
          <dd className="mt-0.5 font-semibold text-ink ltr">
            {formatNumber(anomaly.observed)}
            {unit}
          </dd>
        </div>
        <div>
          <dt className="text-muted">خط الأساس</dt>
          <dd className="mt-0.5 font-semibold text-ink ltr">
            {formatNumber(anomaly.baseline)}
            {unit}
          </dd>
        </div>
        <div>
          <dt className="text-muted">العتبة</dt>
          <dd className="mt-0.5 font-semibold text-ink ltr">
            {formatNumber(anomaly.threshold)}
            {anomaly.unit === "percent" ? "%" : ""}
          </dd>
        </div>
      </dl>

      <ul className="mt-3 space-y-1 border-t border-line/60 pt-2 text-[10.5px] text-muted">
        {anomaly.evidence.map((item) => (
          <li key={`${item.label}-${item.value}`} className="flex justify-between gap-3">
            <span>{item.label}</span>
            <span className="ltr text-ink">
              {evidenceValue(item.value)}
              {item.unit === "%" ? "%" : item.unit === "points" ? " نقطة" : ""}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[10.5px] leading-5 text-ink">
        {anomaly.recommendedAction}
      </p>
    </article>
  );
}

export function AnomalySection({
  report,
  currency,
}: {
  report: AnomalyReport;
  currency: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] text-muted">
          المقارنة مع نافذة سابقة من نفس الطول:{" "}
          <span className="ltr">
            {report.baseline.from?.slice(0, 10) ?? "—"} → {report.baseline.to?.slice(0, 10) ?? "—"}
          </span>
        </p>
        <p className="text-[10.5px] text-muted">
          قواعد حتمية بعتبات منشورة — بلا نموذج ولا تعلّم آلي.
        </p>
      </div>

      {report.anomalies.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[12px] text-muted">
          {report.baseline.available
            ? "لا شذوذ يتجاوز العتبات المنشورة في هذه الفترة. هذا نتيجة، لا نقص في البيانات."
            : `لا مقارنة ممكنة: ${reasonLabel(report.baseline.reason) ?? "لا فترة سابقة"}.`}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {report.anomalies.map((anomaly) => (
            <AnomalyCard key={anomaly.id} anomaly={anomaly} />
          ))}
        </div>
      )}

      {report.suppressed.length > 0 ? (
        <details className="rounded-2xl border border-line bg-surface/40 p-4">
          <summary className="cursor-pointer text-[11px] font-medium text-ink">
            قواعد لم تُشغَّل ({report.suppressed.length})
          </summary>
          <ul className="mt-2 space-y-1 text-[10.5px] text-muted">
            {report.suppressed.map((item) => (
              <li key={`${item.rule}-${item.reason}`} className="flex justify-between gap-3">
                <span className="ltr">{item.rule}</span>
                <span>{reasonLabel(item.reason) ?? item.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="text-[10px] leading-5 text-muted">
        العملة المرجعية: {currency ?? "غير متاحة"}. لا تُقارن مبالغ بعملات مختلفة، ولا تُطلق قاعدة
        بلا خط أساس أو بغطاء جزئي.
      </p>
    </div>
  );
}

export function SeasonalityPanel({ analysis }: { analysis: SeasonalityAnalysis }) {
  return (
    <div className="rounded-2xl border border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink">الموسمية الأسبوعية</h3>
        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] text-muted">
          {analysis.available ? "محسوبة" : "غير متاحة"}
        </span>
      </div>

      {!analysis.available ? (
        <p className="mt-2 text-[11.5px] leading-6 text-muted">
          لا حكم موسمي: {reasonLabel(analysis.reason) ?? analysis.reason}. المطلوب:{" "}
          {analysis.requirements.minDays} يومًا على الأقل، و{analysis.requirements.minOrders} طلبًا،
          و{analysis.requirements.minOccurrencesPerWeekday} تكرارًا لكل يوم أسبوع.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[11.5px] leading-6 text-muted">
            {analysis.verdict === "pattern_detected"
              ? `نمط واضح: أقوى يوم ${analysis.strongest ? WEEKDAY_LABELS_AR[analysis.strongest.weekday] : "—"} بمؤشر ${formatNumber(analysis.strongest?.index ?? null)} مقابل ${formatNumber(analysis.weakest?.index ?? null)} لأضعف يوم.`
              : "لا يظهر فرق كافٍ بين أيام الأسبوع لاعتبار النمط موسميًا."}
          </p>

          <ul className="mt-3 space-y-1.5">
            {analysis.weekdays.map((day) => (
              <li key={day.weekday} className="flex items-center gap-2 text-[10.5px]">
                <span className="w-14 shrink-0 text-muted">{WEEKDAY_LABELS_AR[day.weekday]}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2" dir="ltr">
                  <span
                    className="block h-full rounded-full bg-teal"
                    style={{ width: `${Math.min(100, Math.max(0, (day.index ?? 0) / 2))}%` }}
                  />
                </span>
                <span className="ltr w-14 text-end text-ink">{formatNumber(day.index)}</span>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-[10px] leading-5 text-muted">
            المؤشر 100 = متوسط اليوم. الأيام ذات التكرار الأقل من الحد لا تُحسب. النافذة:{" "}
            {analysis.observed.days} يومًا و{analysis.observed.orders} طلبًا.
          </p>
        </>
      )}
    </div>
  );
}

export function LeakagePanel({ report }: { report: LeakageReport }) {
  return (
    <div className="space-y-3">
      {report.signals.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[12px] text-muted">
          لا إشارات تسرّب مثبتة في هذه الفترة. تُعتبر الإشارة مثبتة فقط عندما تتجاوز عتبة منشورة في
          بيانات الطلبات.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {report.signals.map((signal) => (
            <article key={signal.id} className="rounded-2xl border border-line bg-surface/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md border px-2 py-0.5 text-[10.5px] font-semibold ${SEVERITY_TONES[signal.severity]}`}
                >
                  {SEVERITY_LABELS_AR[signal.severity]}
                </span>
                <span className="text-[10.5px] text-muted">{signal.title}</span>
              </div>
              <p className="mt-2 text-[11.5px] leading-6 text-muted">{signal.description}</p>
              <ul className="mt-2 space-y-1 text-[10.5px] text-muted">
                {signal.evidence.map((item) => (
                  <li key={`${item.label}-${item.value}`} className="flex justify-between gap-3">
                    <span>{item.label}</span>
                    <span className="ltr text-ink">
                      {evidenceValue(item.value)}
                      {item.unit === "%" ? "%" : item.unit === "points" ? " نقطة" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-muted">{signal.rationale}</p>
            </article>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface/40 p-4">
        <h3 className="text-[11.5px] font-semibold text-ink">
          إشارات لا يمكن قياسها من هذه البيانات
        </h3>
        <ul className="mt-2 space-y-1 text-[10.5px] text-muted">
          {report.unavailable.map((item) => (
            <li key={item.id} className="flex justify-between gap-3">
              <span>{item.label}</span>
              <span className="text-muted">{reasonLabel(item.reason) ?? item.reason}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] leading-5 text-muted">
          لا تُعرض نسبة تحويل بصفر: الزيارات والجلسات والسلال المهجورة غير موجودة في المتجر المحلي،
          وغياب البيانات ليس صفرًا.
        </p>
      </div>
    </div>
  );
}

export function DiscountPanel({ analysis }: { analysis: DiscountAnalysis }) {
  return (
    <div className="rounded-2xl border border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink">الخصومات</h3>
        <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-800">
          غير متاح
        </span>
      </div>

      <p className="mt-2 text-[11.5px] leading-6 text-muted">
        {reasonLabel(analysis.reason) ?? analysis.reason} — لا تُحسب قيمة الخصم ولا نسبته ولا
        اتجاهه، ولا تُستنتج من فرق السعر.
      </p>

      <dl className="mt-3 space-y-1.5 text-[10.5px] leading-5 text-muted">
        <div>
          <dt className="inline font-medium text-ink">البيانات المستخدمة: </dt>
          <dd className="inline ltr">{analysis.source.usedEndpoint}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-ink">البيانات المطلوبة: </dt>
          <dd className="inline ltr">{analysis.source.documentedIn}</dd>
        </div>
      </dl>

      <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[10.5px] leading-5 text-muted">
        {analysis.source.note}
      </p>
    </div>
  );
}

export function AlertList({ alerts }: { alerts: readonly SalesAlert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[12px] text-muted">
        لا تنبيهات. التنبيهات استشارية فقط، وتُبنى من نفس الأرقام المعروضة أعلاه.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {alerts.map((alert) => (
        <li
          key={alert.id}
          className={`rounded-xl border px-3 py-2.5 text-[11.5px] ${SEVERITY_TONES[alert.severity]}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{alert.title}</span>
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-[9.5px]">
              استشاري — لا يُنفّذ تلقائيًا
            </span>
          </div>
          <p className="mt-1 leading-6 opacity-90">{alert.message}</p>
          <p className="mt-1 text-[10.5px] leading-5 opacity-80">{alert.action}</p>
        </li>
      ))}
    </ul>
  );
}

export function MetricBasis({ metric }: { metric: Metric<number> }) {
  return (
    <p className="text-[10px] leading-5 text-muted">
      {metric.basis ?? "—"}
      {metric.reason ? ` · ${reasonLabel(metric.reason) ?? metric.reason}` : ""}
    </p>
  );
}
