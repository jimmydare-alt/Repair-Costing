import type { ProjectInput } from "./types";

export type BuilderStep = "Services" | "Project" | "Packages" | "Grinding" | "Screeding" | "Repairs" | "Phase Schedule" | "Project Management" | "Extras" | "Review";

export const builderStepLabels: Record<BuilderStep, string> = {
  Services: "Services",
  Project: "Project",
  Packages: "Work Packages",
  Grinding: "Grinding",
  Screeding: "Screeding",
  Repairs: "Repairs",
  "Phase Schedule": "Phase Programme",
  "Project Management": "Project Management",
  Extras: "Extras",
  Review: "Review"
};

export function visibleBuilderSteps(input: ProjectInput): BuilderStep[] {
  if (input.pricingMode === "selectable") {
    return [
      "Project",
      "Services",
      "Packages",
      ...(input.workPackages.length > 1 ? ["Phase Schedule" as const] : []),
      "Project Management",
      "Extras",
      "Review"
    ];
  }
  const serviceCount = Number(input.includeGrinding) + Number(input.includeScreeding) + Number(input.includeRepairs);
  return [
    "Project",
    "Services",
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
  return requested && visible.includes(requested) ? requested : "Project";
}

export function adjacentBuilderStep(input: ProjectInput, direction: -1 | 1): BuilderStep {
  const visible = visibleBuilderSteps(input);
  const current = visible.indexOf(resolveBuilderStep(input));
  return visible[Math.min(visible.length - 1, Math.max(0, current + direction))];
}

export function costingInputsEqual(left: ProjectInput, right: ProjectInput) {
  const costing = ({ uiProgress: _progress, activeWorkPackageId: _active, ...input }: ProjectInput) => ({
    ...input,
    workPackages: input.workPackages.map(({ uiProgress: _packageProgress, ...workPackage }) => workPackage)
  });
  return JSON.stringify(costing(left)) === JSON.stringify(costing(right));
}

export function parseEditRoute(pathname: string) {
  const match = pathname.match(/^\/new-project\/([^/]+)(?:\/([^/]+))?(?:\/(revision))?$/);
  const segment = match?.[2]?.toLowerCase();
  const step: BuilderStep | undefined = segment === "project" ? "Project" : segment === "grinding" ? "Grinding" : segment === "screeding" ? "Screeding" : segment === "repairs" ? "Repairs" : undefined;
  return {
    projectId: match?.[1] ? decodeURIComponent(match[1]) : "",
    step,
    createsRevision: match?.[3] === "revision" || segment === "revision"
  };
}
