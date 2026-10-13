import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type AiQuote = {
  status?: string;
  finalTotal?: number | string;
  initialTotal?: number | string;
  vendor?: { company?: string } | null;
};

export async function POST(request: NextRequest) {
  try {
    const { prompt, context } = await request.json();
    const question = String(prompt ?? "").trim();
    if (!question) return Response.json({ error: "Ask a question about this RFQ." }, { status: 400 });

    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey) {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.25,
          max_tokens: 700,
          messages: [
            { role: "system", content: "You are a careful procurement analyst. Answer using only the RFQ facts provided. Be concise, cite RFQ/vendor/item names and amounts, and flag assumptions. Format with short paragraphs or bullets." },
            { role: "user", content: `PROCUREMENT DATA:\n${JSON.stringify(context ?? {}, null, 2).slice(0, 14000)}\n\nQUESTION: ${question}` },
          ],
        }),
      });
      const data = await response.json();
      if (!response.ok) return Response.json({ error: data?.error?.message ?? "The AI service is temporarily unavailable." }, { status: response.status });
      return Response.json({ answer: data.choices?.[0]?.message?.content ?? "No answer was returned." });
    }

    const portfolio = Array.isArray(context?.rfqs) ? context.rfqs as Array<Record<string, unknown>> : [];
    if (!context?.rfq && portfolio.length) {
      const lower = question.toLowerCase();
      const closingSoon = portfolio.filter((row) => {
        if (!row.endAt) return false;
        const deadline = new Date(String(row.endAt)).getTime();
        return deadline >= Date.now() && deadline <= Date.now() + 7 * 24 * 60 * 60 * 1000;
      });
      const grouped = portfolio.reduce<Record<string, number>>((acc, row) => {
        const status = String(row.status ?? "Unknown");
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
      }, {});
      let answer = `Your workspace has ${portfolio.length} requirements. ${grouped.Live ?? 0} are live, ${grouped.Draft ?? 0} are drafts, and ${grouped["Negotiation Scheduled"] ?? 0} are scheduled. ${closingSoon.length} RFQ(s) close in the next seven days.`;
      if (/clos|deadline|ending|due|week/.test(lower)) answer = closingSoon.length
        ? `RFQs closing in the next seven days:\n${closingSoon.map((row) => `• ${row.number}: ${row.title} — ${new Date(String(row.endAt)).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`).join("\n")}`
        : "No RFQs have a closing deadline in the next seven days.";
      else if (/draft/.test(lower)) answer = `There are ${grouped.Draft ?? 0} draft RFQs. ${portfolio.filter((row) => row.status === "Draft").map((row) => `${row.number} — ${row.title}`).join("; ") || "No draft requirements are waiting."}`;
      else if (/urgent|critical|high priority/.test(lower)) {
        const urgent = portfolio.filter((row) => ["High", "Critical"].includes(String(row.urgency)));
        answer = urgent.length ? `${urgent.length} high-urgency requirement(s): ${urgent.map((row) => `${row.number} — ${row.title} (${row.status})`).join("; ")}` : "No high or critical urgency RFQs are currently listed.";
      } else if (/status|stage|pipeline/.test(lower)) answer = `Pipeline by status: ${Object.entries(grouped).map(([status, count]) => `${status}: ${count}`).join(" · ")}.`;
      return Response.json({ answer, source: "rfq-portfolio" });
    }

    const rfq = context?.rfq ?? {};
    const quotes: AiQuote[] = Array.isArray(context?.quotes) ? context.quotes as AiQuote[] : [];
    const ranked = [...quotes].filter((quote) => quote.status !== "Pending" && quote.status !== "Rejected").sort((a, b) => Number(a.finalTotal) - Number(b.finalTotal));
    const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: rfq.currency || "INR", maximumFractionDigits: 0 }).format(value || 0);
    const winner = ranked[0];
    const lower = question.toLowerCase();
    let answer = `For ${rfq.number ?? "this RFQ"}, ${ranked.length} vendors have submitted quotations across ${context?.items?.length ?? 0} line items. The negotiation is currently ${String(rfq.status ?? "in progress").toLowerCase()}.`;
    if (/l1|lowest|best vendor|winner/.test(lower) && winner) {
      answer = `${winner.vendor?.company ?? "The leading vendor"} is currently L1 at ${money(Number(winner.finalTotal))}. ${ranked.length > 1 ? `The next offer from ${ranked[1].vendor?.company} is ${money(Number(ranked[1].finalTotal))}, a gap of ${money(Number(ranked[1].finalTotal) - Number(winner.finalTotal))}.` : "No second submitted quote is available yet."}`;
    } else if (/red flag|risk|concern/.test(lower)) {
      answer = `Watch these points: ${quotes.filter((quote) => quote.status === "Pending").length} vendor(s) have not submitted, check landed-cost assumptions and delivery commitments before approval, and verify each counter offer is within the authorized price cap. ${winner ? `${winner.vendor?.company} currently leads at ${money(Number(winner.finalTotal))}.` : "There are no submitted offers to compare yet."}`;
    } else if (/change|history|trend|across bids|price/.test(lower)) {
      answer = `${ranked.slice(0, 3).map((quote, index) => `${index + 1}. ${quote.vendor?.company}: final ${money(Number(quote.finalTotal))} vs initial ${money(Number(quote.initialTotal))} (${Number(quote.initialTotal) ? (((Number(quote.initialTotal) - Number(quote.finalTotal)) / Number(quote.initialTotal)) * 100).toFixed(1) : "0.0"}% reduction)`).join("\n") || "Bid history will appear as vendors submit quotations."}`;
    } else if (/summary|summari/.test(lower)) {
      answer = `${rfq.title ?? "This RFQ"} has ${context?.items?.length ?? 0} items and ${quotes.length} invited vendors. ${ranked.length} quotations are in; ${quotes.filter((quote) => quote.status === "Pending").length} are still pending. ${winner ? `${winner.vendor?.company} currently offers the lowest total at ${money(Number(winner.finalTotal))}.` : "The team is still waiting for the first quote."}`;
    } else if (winner) {
      answer = `${winner.vendor?.company} is currently the lowest submitted quote at ${money(Number(winner.finalTotal))}. Compare landed cost, delivery lead time, warranty, and commercial terms before awarding; the lowest headline price is not always the lowest total cost.`;
    }
    return Response.json({ answer, source: "rfq-analysis" });
  } catch (error) {
    console.error("AI analysis failed", error);
    return Response.json({ error: "Could not analyze this RFQ right now." }, { status: 500 });
  }
}
