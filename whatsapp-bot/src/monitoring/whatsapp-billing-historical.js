/**
 * Combina filas SQL del día con agregados históricos cuando la retención borró mensajes originales.
 */
export function mergeSqlWithHistorical(sqlDaily, storedRows) {
  const sqlByDay = new Map((sqlDaily || []).map((row) => [row.dayAr, row]));
  const histByDay = new Map((storedRows || []).map((row) => [row.dayAr, row]));
  const allDays = [...new Set([...sqlByDay.keys(), ...histByDay.keys()])].sort();
  return allDays.map((dayAr) => {
    const sql = sqlByDay.get(dayAr);
    const hist = histByDay.get(dayAr);
    if (sql) return sql;
    if (hist) {
      return {
        dayAr,
        inbound: hist.inbound,
        outbound: hist.outbound,
        whatsappOutbound: hist.outbound,
        outboundBot: hist.outboundBot,
        outboundAgent: hist.outboundAgent,
        outboundSystem: 0,
        fromHistoricalAggregate: true,
      };
    }
    return null;
  }).filter(Boolean);
}

export default { mergeSqlWithHistorical };