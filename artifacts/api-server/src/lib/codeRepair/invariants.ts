export interface FieldInvariant {
  validate: (value: unknown) => boolean;
  description: string;
}

export const FIELD_INVARIANTS: Record<string, FieldInvariant> = {
  location: {
    validate: (value) => typeof value === "string",
    description: "Location should be a string.",
  },
  vehicle: {
    validate: (value) => typeof value === "string",
    description: "Vehicle descriptor should be a string.",
  },
  vin: {
    validate: (value) => typeof value === "string" && /^[A-HJ-NPR-Z0-9]{17}$/i.test(value.trim()),
    description: "VIN must be 17 alphanumeric characters (excluding I/O/Q).",
  },
  onlinePrice: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
      return Number.isFinite(parsed) && parsed > 0 && parsed < 500000;
    },
    description: "Online price must parse as positive currency under 500k.",
  },
  price: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
      return Number.isFinite(parsed) && parsed >= 0 && parsed < 500000;
    },
    description: "Price must parse as non-negative currency under 500k.",
  },
  km: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").replace(/[^\d]/g, ""));
      return Number.isFinite(parsed) && parsed >= 0 && parsed < 2_000_000;
    },
    description: "KM must parse as non-negative integer under 2 million.",
  },
  matrixPrice: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
      return Number.isFinite(parsed) || String(value ?? "").trim() === "";
    },
    description: "Matrix price is numeric or empty.",
  },
  cost: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
      return Number.isFinite(parsed) || String(value ?? "").trim() === "";
    },
    description: "Cost is numeric or empty.",
  },
  hasPhotos: {
    validate: (value) => typeof value === "boolean",
    description: "hasPhotos must be boolean.",
  },
  bbAvgWholesale: {
    validate: (value) => value === undefined || value === null || typeof value === "string",
    description: "BB average wholesale is optional string.",
  },
  bbValues: {
    validate: (value) => value === undefined || value === null || typeof value === "object",
    description: "bbValues is optional object.",
  },
  xclean: {
    validate: (value) => Number.isFinite(Number(value)),
    description: "bbValues.xclean must be numeric.",
  },
  clean: {
    validate: (value) => Number.isFinite(Number(value)),
    description: "bbValues.clean must be numeric.",
  },
  avg: {
    validate: (value) => Number.isFinite(Number(value)),
    description: "bbValues.avg must be numeric.",
  },
  rough: {
    validate: (value) => Number.isFinite(Number(value)),
    description: "bbValues.rough must be numeric.",
  },
  year: {
    validate: (value) => {
      const parsed = Number(String(value ?? "").trim());
      return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2035;
    },
    description: "Year must be integer between 1900 and 2035.",
  },
  website: {
    validate: (value) => typeof value === "string" && (value.startsWith("http") || value === "NOT FOUND" || value === ""),
    description: "Website field should be URL, NOT FOUND, or empty.",
  },
  carfax: {
    validate: (value) => typeof value === "string" && (value.startsWith("http") || value === "NOT FOUND" || value === ""),
    description: "Carfax field should be URL, NOT FOUND, or empty.",
  },
};

export function validateInvariant(field: string, value: unknown): boolean {
  const invariant = FIELD_INVARIANTS[field];
  if (!invariant) return true;
  return invariant.validate(value);
}

