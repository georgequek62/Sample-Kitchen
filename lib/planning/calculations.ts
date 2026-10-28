export type PlanningScenario = {
  timezone: string;
  order_cutoff: string;
  week_start: string;
  week_end: string;
  settings: {
    permanent_shift_start: string;
    permanent_shift_end: string;
    permanent_break_start: string;
    permanent_break_minutes: number;
    permanent_productive_hours: number;
    part_time_productive_hours: number;
    max_shifts_per_person_per_day: number;
  };
};

export type PlanningProduct = { id: string; name: string; labourHoursPerUnit: number };
export type PlanningRecipe = { productId: string; ingredientId: string; quantityPerUnit: number };
export type PlanningOrder = {
  orderId: string;
  productionDate: Date | string;
  customer: string;
  productId: string;
  quantity: number;
  status: string;
  receivedAt: Date | string;
};
export type PlanningIngredient = { id: string; name: string | null; unit: string | null };
export type PlanningInventory = {
  ingredientId: string;
  onHand: number;
  committed: number;
  packSize: number;
  packName: string;
};
export type PlanningStaff = {
  id: string;
  name: string;
  employmentType: "PERMANENT" | "PART_TIME";
  role: string;
  skills: string[];
};
export type PlanningLeave = { staffId: string; date: Date | string; status: string; reason: string | null };
export type PlanningAvailability = {
  staffId: string;
  date: Date | string;
  start: string;
  end: string;
  status: string;
};

export type PlanningInputs = {
  scenario: PlanningScenario;
  products: PlanningProduct[];
  recipes: PlanningRecipe[];
  orders: PlanningOrder[];
  ingredients: PlanningIngredient[];
  inventory: PlanningInventory[];
  staff: PlanningStaff[] | null;
  leave: PlanningLeave[] | null;
  availability: PlanningAvailability[] | null;
};

export type PlanningResult = {
  planningWindow: { timezone: string; cutoff: string; start: string; end: string };
  eligibleOrders: Array<PlanningOrder & { productionDate: string; receivedAt: string }>;
  excludedOrders: Array<PlanningOrder & { productionDate: string; receivedAt: string; reasons: string[] }>;
  dailyProduction: Array<{
    date: string;
    products: Array<{ productId: string; productName: string; quantity: number }>;
    totalSandwiches: number;
    labourHours: number;
  }>;
  roster: null | Array<{
    date: string;
    requiredLabourHours: number;
    assignedProductiveHours: number;
    uncoveredHours: number;
    additionalPartTimeShiftsToRequest: number;
    supervisorQualifiedWorkerAvailable: boolean;
    supervisorAssigned: string | null;
    assignments: Array<{
      staffId: string;
      name: string;
      employmentType: "PERMANENT" | "PART_TIME";
      role: string;
      start: string;
      end: string;
      breakStart: string | null;
      breakMinutes: number;
      productiveHours: number;
    }>;
  }>;
  pendingLeaveAlerts: null | Array<{ staffId: string; staffName: string; date: string; reason: string | null }>;
  ingredientDemand: Array<{
    ingredientId: string;
    name: string;
    unit: string | null;
    requiredQuantity: number;
    onHand: number | null;
    committed: number | null;
    usableStock: number | null;
    shortage: number | null;
    packSize: number | null;
    packName: string | null;
    packsToOrder: number | null;
    quantityToOrder: number | null;
  }>;
  missingInventoryIngredients: string[];
};

type RosterCandidate = {
  staff: PlanningStaff;
  start: string;
  end: string;
  breakStart: string | null;
  breakMinutes: number;
  hours: number;
};

function asDateKey(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function datesInRange(start: string, end: string): string[] {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || start > end) {
    throw new Error("The planning week reference dates are invalid.");
  }

  const dates: string[] = [];
  for (const date = new Date(startDate); date <= endDate; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function normal(value: string): string {
  return value.trim().toLowerCase();
}

function isProductionWorker(staff: PlanningStaff): boolean {
  return staff.skills.some((skill) => normal(skill) === "production");
}

function isSupervisor(staff: PlanningStaff): boolean {
  return staff.skills.some((skill) => normal(skill) === "supervisor") || /\b(lead|supervisor)\b/i.test(staff.role);
}

export function calculatePlan(input: PlanningInputs): PlanningResult {
  const { scenario } = input;
  const { week_start: start, week_end: end, order_cutoff: cutoffText } = scenario;
  const cutoff = new Date(cutoffText);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("The order cutoff reference is invalid.");
  const dates = datesInRange(start, end);
  const dateSet = new Set(dates);

  const eligibleOrders: PlanningResult["eligibleOrders"] = [];
  const excludedOrders: PlanningResult["excludedOrders"] = [];
  for (const order of input.orders) {
    const productionDate = asDateKey(order.productionDate);
    const receivedAt = toIso(order.receivedAt);
    const reasons: string[] = [];
    if (normal(order.status) !== "confirmed") reasons.push("Order status is not Confirmed.");
    if (!dateSet.has(productionDate)) reasons.push("Production date is outside the planning week.");
    if (new Date(receivedAt).getTime() > cutoff.getTime()) reasons.push("Order was received after the cutoff.");

    const normalizedOrder = { ...order, productionDate, receivedAt };
    if (reasons.length) excludedOrders.push({ ...normalizedOrder, reasons });
    else eligibleOrders.push(normalizedOrder);
  }
  const orderSort = (a: { productionDate: string; orderId: string }, b: { productionDate: string; orderId: string }) =>
    a.productionDate.localeCompare(b.productionDate) || a.orderId.localeCompare(b.orderId);
  eligibleOrders.sort(orderSort);
  excludedOrders.sort(orderSort);

  const productById = new Map(input.products.map((product) => [product.id, product]));
  const recipesByProduct = new Map<string, PlanningRecipe[]>();
  for (const recipe of input.recipes) {
    const recipes = recipesByProduct.get(recipe.productId) ?? [];
    recipes.push(recipe);
    recipesByProduct.set(recipe.productId, recipes);
  }

  const quantitiesByDay = new Map<string, Map<string, number>>();
  const labourByDay = new Map<string, number>();
  const ingredientRequired = new Map<string, number>();
  for (const date of dates) quantitiesByDay.set(date, new Map());
  for (const order of eligibleOrders) {
    const daily = quantitiesByDay.get(order.productionDate)!;
    daily.set(order.productId, (daily.get(order.productId) ?? 0) + order.quantity);
    const product = productById.get(order.productId);
    if (!product) throw new Error(`A saved order references unknown product ${order.productId}.`);
    labourByDay.set(order.productionDate, (labourByDay.get(order.productionDate) ?? 0) + order.quantity * product.labourHoursPerUnit);
    for (const recipe of recipesByProduct.get(order.productId) ?? []) {
      ingredientRequired.set(recipe.ingredientId, (ingredientRequired.get(recipe.ingredientId) ?? 0) + order.quantity * recipe.quantityPerUnit);
    }
  }

  const dailyProduction = dates.map((date) => {
    const quantities = quantitiesByDay.get(date)!;
    const products = input.products
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((product) => ({ productId: product.id, productName: product.name, quantity: quantities.get(product.id) ?? 0 }));
    return {
      date,
      products,
      totalSandwiches: products.reduce((sum, product) => sum + product.quantity, 0),
      labourHours: round(labourByDay.get(date) ?? 0),
    };
  });

  const staffById = new Map((input.staff ?? []).map((staff) => [staff.id, staff]));
  const leaveByStaffDate = new Map<string, PlanningLeave[]>();
  for (const leave of input.leave ?? []) {
    const key = `${leave.staffId}:${asDateKey(leave.date)}`;
    const records = leaveByStaffDate.get(key) ?? [];
    records.push(leave);
    leaveByStaffDate.set(key, records);
  }
  const availabilityByStaffDate = new Map<string, PlanningAvailability>();
  for (const availability of input.availability ?? []) {
    if (normal(availability.status) === "confirmed") {
      availabilityByStaffDate.set(`${availability.staffId}:${asDateKey(availability.date)}`, availability);
    }
  }

  const weeklyHours = new Map<string, number>();
  const roster = input.staff === null ? null : dates.map((date) => {
    const requiredLabourHours = round(labourByDay.get(date) ?? 0);
    const candidates = input.staff!.reduce<RosterCandidate[]>((eligible, staff) => {
        if (!isProductionWorker(staff)) return eligible;
        const leave = leaveByStaffDate.get(`${staff.id}:${date}`) ?? [];
        if (leave.some((record) => normal(record.status) === "approved")) return eligible;
        if (staff.employmentType === "PERMANENT") {
          eligible.push({
            staff,
            start: scenario.settings.permanent_shift_start,
            end: scenario.settings.permanent_shift_end,
            breakStart: scenario.settings.permanent_break_start,
            breakMinutes: scenario.settings.permanent_break_minutes,
            hours: scenario.settings.permanent_productive_hours,
          });
          return eligible;
        }
        const availability = availabilityByStaffDate.get(`${staff.id}:${date}`);
        if (availability) eligible.push({ staff, start: availability.start, end: availability.end, breakStart: null, breakMinutes: 0, hours: scenario.settings.part_time_productive_hours });
        return eligible;
      }, []);
    const sortCandidates = (left: RosterCandidate, right: RosterCandidate) => {
      const typePriority = (left.staff.employmentType === "PERMANENT" ? 0 : 1) - (right.staff.employmentType === "PERMANENT" ? 0 : 1);
      return typePriority
        || (weeklyHours.get(left.staff.id) ?? 0) - (weeklyHours.get(right.staff.id) ?? 0)
        || left.staff.name.localeCompare(right.staff.name);
    };
    const availableLeads = candidates.filter(({ staff }) => isSupervisor(staff)).sort(sortCandidates);
    const assignments: NonNullable<PlanningResult["roster"]>[number]["assignments"] = [];
    const assignedIds = new Set<string>();
    let assignedProductiveHours = 0;
    let supervisorAssigned: string | null = null;

    const assign = (candidate: (typeof candidates)[number]) => {
      if (assignedIds.has(candidate.staff.id)) return;
      assignedIds.add(candidate.staff.id);
      assignedProductiveHours += candidate.hours;
      weeklyHours.set(candidate.staff.id, (weeklyHours.get(candidate.staff.id) ?? 0) + candidate.hours);
      assignments.push({
        staffId: candidate.staff.id,
        name: candidate.staff.name,
        employmentType: candidate.staff.employmentType,
        role: candidate.staff.role,
        start: candidate.start,
        end: candidate.end,
        breakStart: candidate.breakStart,
        breakMinutes: candidate.breakMinutes,
        productiveHours: candidate.hours,
      });
    };

    if (requiredLabourHours > 0 && availableLeads.length > 0) {
      assign(availableLeads[0]);
      supervisorAssigned = availableLeads[0].staff.id;
    }
    while (assignedProductiveHours < requiredLabourHours) {
      const next = candidates.filter(({ staff }) => !assignedIds.has(staff.id)).sort(sortCandidates)[0];
      if (!next) break;
      assign(next);
    }

    const uncoveredHours = round(Math.max(0, requiredLabourHours - assignedProductiveHours));
    return {
      date,
      requiredLabourHours,
      assignedProductiveHours,
      uncoveredHours,
      additionalPartTimeShiftsToRequest: Math.ceil(uncoveredHours / scenario.settings.part_time_productive_hours),
      supervisorQualifiedWorkerAvailable: availableLeads.length > 0,
      supervisorAssigned,
      assignments,
    };
  });

  const pendingLeaveAlerts = input.leave === null ? null : input.leave
    .filter((leave) => normal(leave.status) === "pending" && dateSet.has(asDateKey(leave.date)))
    .map((leave) => ({
      staffId: leave.staffId,
      staffName: staffById.get(leave.staffId)?.name ?? leave.staffId,
      date: asDateKey(leave.date),
      reason: leave.reason,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName));

  const inventoryByIngredient = new Map(input.inventory.map((record) => [record.ingredientId, record]));
  const ingredientById = new Map(input.ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const ingredientIds = new Set([...input.ingredients.map(({ id }) => id), ...ingredientRequired.keys()]);
  const missingInventoryIngredients: string[] = [];
  const ingredientDemand = [...ingredientIds].sort().map((ingredientId) => {
    const ingredient = ingredientById.get(ingredientId);
    const inventory = inventoryByIngredient.get(ingredientId);
    if (!inventory) missingInventoryIngredients.push(ingredientId);
    const requiredQuantity = round(ingredientRequired.get(ingredientId) ?? 0);
    if (!inventory) {
      return {
        ingredientId,
        name: ingredient?.name ?? ingredientId,
        unit: ingredient?.unit ?? null,
        requiredQuantity,
        onHand: null,
        committed: null,
        usableStock: null,
        shortage: null,
        packSize: null,
        packName: null,
        packsToOrder: null,
        quantityToOrder: null,
      };
    }
    const usableStock = round(inventory.onHand - inventory.committed);
    const shortage = round(Math.max(0, requiredQuantity - usableStock));
    const packsToOrder = shortage === 0 ? 0 : Math.ceil(shortage / inventory.packSize - 1e-10);
    return {
      ingredientId,
      name: ingredient?.name ?? ingredientId,
      unit: ingredient?.unit ?? null,
      requiredQuantity,
      onHand: inventory.onHand,
      committed: inventory.committed,
      usableStock,
      shortage,
      packSize: inventory.packSize,
      packName: inventory.packName,
      packsToOrder,
      quantityToOrder: round(packsToOrder * inventory.packSize),
    };
  });

  return {
    planningWindow: { timezone: scenario.timezone, cutoff: cutoff.toISOString(), start, end },
    eligibleOrders,
    excludedOrders,
    dailyProduction,
    roster,
    pendingLeaveAlerts,
    ingredientDemand,
    missingInventoryIngredients,
  };
}
