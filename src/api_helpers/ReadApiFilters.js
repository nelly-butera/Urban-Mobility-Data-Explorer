/**
 * - Validate query params from API.
 * - Build SQL WHERE + params safely.
 */
const BOROUGH_TEXT = {
  manhattan: "Manhattan",
  brooklyn: "Brooklyn",
  queens: "Queens",
  bronx: "Bronx",
  staten_island: "Staten Island",
  all: null,
};

const PAYMENT_TEXT = {
  credit_card: "credit_card",
  cash: "cash",
  no_charge: "no_charge",
  all: null,
};

const TIME_SET = new Set(["all", "peak", "off_peak", "morning_rush", "evening_rush"]);
const DATE_SET = new Set(["7d", "30d", "quarter", "ytd"]);

class ReadApiFilters {
  readFromQuery(query) {
    const dateRange = query.date_range || "30d";
    const borough = query.borough || "all";
    const paymentType = query.payment_type || "all";
    const timeOfDay = query.time_of_day || "all";

    if (!DATE_SET.has(dateRange)) {
      throw new Error(`Invalid date_range filter: ${query.date_range}`);
    }
    if (!(borough in BOROUGH_TEXT)) {
      throw new Error(`Invalid borough filter: ${query.borough}`);
    }
    if (!(paymentType in PAYMENT_TEXT)) {
      throw new Error(`Invalid payment_type filter: ${query.payment_type}`);
    }
    if (!TIME_SET.has(timeOfDay)) {
      throw new Error(`Invalid time_of_day filter: ${query.time_of_day}`);
    }

    return {
      dateRange,
      borough: BOROUGH_TEXT[borough],
      paymentType: PAYMENT_TEXT[paymentType],
      timeOfDay,
    };
  }

  makeWhereSql(filters, alias, dateColumn, startIndex = 1, columns = {}) {
    const boroughCol = columns.borough || "borough";
    const paymentCol = columns.payment || "payment_type_group";
    const timeCol = columns.time || "time_bucket";

    const whereParts = [this.#getDateRangeSql(filters.dateRange, alias, dateColumn)];
    const values = [];
    let next = startIndex;

    if (filters.borough) {
      whereParts.push(`${alias}.${boroughCol} = $${next}`);
      values.push(filters.borough);
      next += 1;
    }

    if (filters.paymentType) {
      whereParts.push(`${alias}.${paymentCol} = $${next}`);
      values.push(filters.paymentType);
      next += 1;
    }

    if (filters.timeOfDay === "morning_rush" || filters.timeOfDay === "evening_rush") {
      whereParts.push(`${alias}.${timeCol} = $${next}`);
      values.push(filters.timeOfDay);
      next += 1;
    } else if (filters.timeOfDay === "off_peak") {
      whereParts.push(`${alias}.${timeCol} = 'off_peak'`);
    } else if (filters.timeOfDay === "peak") {
      whereParts.push(`${alias}.${timeCol} IN ('morning_rush', 'evening_rush')`);
    }

    return {
      clause: `WHERE ${whereParts.join(" AND ")}`,
      params: values,
      nextIndex: next,
    };
  }

  #getDateRangeSql(dateRange, alias, dateColumn) {
    const anchor = "(SELECT COALESCE(MAX(pickup_date), CURRENT_DATE) FROM summary_overview_daily)";
    if (dateRange === "7d") {
      return `${alias}.${dateColumn} >= (${anchor} - INTERVAL '6 day')`;
    }
    if (dateRange === "30d") {
      return `${alias}.${dateColumn} >= (${anchor} - INTERVAL '29 day')`;
    }
    if (dateRange === "quarter") {
      return `${alias}.${dateColumn} >= (${anchor} - INTERVAL '3 month')`;
    }
    return `${alias}.${dateColumn} >= DATE_TRUNC('year', ${anchor})::DATE`;
  }
}

module.exports = { ReadApiFilters };
