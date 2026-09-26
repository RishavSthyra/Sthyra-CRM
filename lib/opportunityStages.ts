import { isObject } from "@/utils/isObject";

export type OpportunityStageInput = {
  stage_key: string;
  stage_name: string;
  position: number;
  probability: number;
  color: string;
  is_initial: boolean;
};

type ValidationResult =
  { ok: true; data: OpportunityStageInput[] } | { ok: false; errors: string[] };

export function validateOpportunityStages(body: unknown): ValidationResult {
  if (!isObject(body) || Array.isArray(body) || !Array.isArray(body.stages)) {
    return { ok: false, errors: ["stages must be an array"] };
  }

  const errors: string[] = [];
  const keys = new Set<string>();
  const stages: OpportunityStageInput[] = [];

  body.stages.forEach((value, index) => {
    if (!isObject(value) || Array.isArray(value)) {
      errors.push(`stages[${index}] must be an object`);
      return;
    }
    const allowed = new Set([
      "stage_key",
      "stage_name",
      "probability",
      "color",
      "is_initial",
    ]);
    Object.keys(value)
      .filter((key) => !allowed.has(key))
      .forEach((key) =>
        errors.push(`Unknown field in stages[${index}]: ${key}`),
      );

    const stageKey =
      typeof value.stage_key === "string"
        ? value.stage_key.trim().toLowerCase()
        : "";
    const stageName =
      typeof value.stage_name === "string" ? value.stage_name.trim() : "";
    const probability = Number(value.probability);
    const color = typeof value.color === "string" ? value.color.trim() : "";

    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(stageKey) || stageKey.length > 100)
      errors.push(`stages[${index}].stage_key is invalid`);
    if (!stageName || stageName.length > 100)
      errors.push(
        `stages[${index}].stage_name is required and must not exceed 100 characters`,
      );
    if (!Number.isInteger(probability) || probability < 0 || probability > 100)
      errors.push(
        `stages[${index}].probability must be an integer between 0 and 100`,
      );
    if (!/^#[0-9a-f]{6}$/i.test(color))
      errors.push(`stages[${index}].color must be a six-digit hex colour`);
    if (typeof value.is_initial !== "boolean")
      errors.push(`stages[${index}].is_initial must be a boolean`);
    if (keys.has(stageKey)) errors.push(`Duplicate stage_key: ${stageKey}`);
    keys.add(stageKey);

    if (stageKey && stageName && Number.isInteger(probability) && color) {
      stages.push({
        stage_key: stageKey,
        stage_name: stageName,
        position: index + 1,
        probability,
        color,
        is_initial: value.is_initial === true,
      });
    }
  });

  if (!stages.length) errors.push("At least one opportunity stage is required");
  if (stages.filter((stage) => stage.is_initial).length !== 1)
    errors.push("Exactly one opportunity stage must have is_initial=true");

  return errors.length ? { ok: false, errors } : { ok: true, data: stages };
}
