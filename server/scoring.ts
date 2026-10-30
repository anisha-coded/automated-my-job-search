import type { Profile } from "./types.js";

const words = (value: string): Set<string> =>
  new Set(
    (value.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [])
      .map((word) => word.replace(/^\.+|\.+$/g, ""))
      .filter(Boolean),
  );

export function scoreJob(
  job: { title: string; description: string; location: string; company: string },
  profile: Profile,
): number {
  const companyKey = job.company.trim().toLowerCase();
  if (profile.excludedCompanies.some((name) => name.trim().toLowerCase() === companyKey)) return 0;

  const titleWords = words(job.title);
  const roleMatch = profile.targetRoles.some((role) => {
    const roleWords = [...words(role)];
    return roleWords.length > 0 && roleWords.some((word) => titleWords.has(word));
  });
  const jobWords = words(`${job.title} ${job.description}`);
  const skillMatch = profile.skills.filter((skill) => {
    const skillWords = [...words(skill)];
    return skillWords.length > 0 && skillWords.every((word) => jobWords.has(word));
  }).length;
  const location = job.location.toLowerCase();
  const workplace = `${job.location} ${job.description}`.toLowerCase();
  const remoteMatch =
    profile.remotePreference === "any" ||
    (profile.remotePreference === "remote" && /remote|anywhere/.test(workplace)) ||
    (profile.remotePreference === "hybrid" && /hybrid/.test(workplace)) ||
    (profile.remotePreference === "onsite" && !/remote/.test(workplace));
  const locationMatch =
    profile.locations.length === 0 ||
    profile.locations.some((target) => location.includes(target.toLowerCase()));
  const experienceText = job.description.match(
    /(\d+(?:\.\d+)?)\s*\+?\s*(?:years|yrs)\s+(?:of\s+)?(?:relevant\s+)?experience/i,
  );
  const inferredYears = experienceText
    ? Number(experienceText[1])
    : /\b(?:principal|staff|director)\b/i.test(job.title)
      ? 8
      : /\b(?:senior|lead)\b/i.test(job.title)
        ? 5
        : /\b(?:junior|entry[- ]level)\b/i.test(job.title)
          ? 0
          : null;
  const experienceMatch =
    inferredYears === null ||
    ((profile.minYearsExperience === null || inferredYears >= profile.minYearsExperience) &&
      (profile.maxYearsExperience === null || inferredYears <= profile.maxYearsExperience));

  const rolePoints = roleMatch ? 4 : 0;
  const skillPoints = Math.min(4, skillMatch);
  const locationPoints = locationMatch && remoteMatch ? 1 : 0;
  const experiencePoints = experienceMatch ? 1 : 0;
  return Math.min(10, rolePoints + skillPoints + locationPoints + experiencePoints);
}
