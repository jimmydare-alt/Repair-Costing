import type { ProjectInput } from "./types";

export type BuilderStep = "Services" | "Project" | "Grinding" | "Screeding" | "Repairs" | "Phase Schedule" | "Project Management" | "Extras" | "Review";

export const builderStepLabels: Record<BuilderStep, string> = {
  Services: "Services",
  Project: "Project",
  Grinding: "Grinding",
  Screeding: "Screeding",
  Repairs: "Repairs",
  "Phase Schedule": "Phase Programme",
  "Project Management": "Project Management",
  Extras: "Extras",
  Review: "Review"
};

export function visibleBuilderSteps(input: ProjectInput): BuilderStep[] {
  const serviceCount = Number(input.includeGrinding) + Number(input.includeScreeding) + Number(input.includeRepairs);
  return [
    "Services",
    "Project",
    ...(input.includeGrinding ? ["Grinding" as const] : []),
    ...(input.includeScreeding ? ["Screeding" as const] : []),
    ...(input.includeRepairs ? ["Repairs" as const] : []),
    ...(serviceCount > 1 ? ["Phase Schedule" as const] : []),
    "Project Management",
    "Extras",
    "Review"
  ];
}

export function resolveBuilderStep(input: ProjectInput): BuilderStep {
  const requested = input.uiProgress?.builderStep as BuilderStep | undefined;
  const visible = visibleBuilderSteps(input);
  return requested && visible.includes(requested) ? requested : "Services";
}

export function adjacentBuilderStep(input: ProjectInput, direction: -1 | 1): BuilderStep {
  const visible = visibleBuilderSteps(input);
  const current = visible.indexOf(resolveBuilderStep(input));
  return visible[Math.min(visible.length - 1, Math.max(0, current + direction))];
}

export function parseEditRoute(pathname: string) {
  const match = pathname.match(/^\/new-project\/([^/]+)(?:\/([^/]+))?(?:\/(revision))?$/);
  const segment = match?.[2]?.toLowerCase();
  const step: BuilderStep | undefined = segment === "grinding" ? "Grinding" : segment === "screeding" ? "Screeding" : segment === "repairs" ? "Repairs" : undefined;
  return {
    projectId: match?.[1] ? decodeURIComponent(match[1]) : "",
    step,
    createsRevision: match?.[3] === "revision" || segment === "revision"
  };
}
