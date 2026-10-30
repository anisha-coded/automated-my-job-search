import type { Profile } from "./types.js";

const skillVocabulary = [
  "javascript", "typescript", "react", "node.js", "python", "java", "sql", "figma",
  "product design", "user research", "accessibility", "project management", "data analysis",
  "machine learning", "aws", "communication", "leadership", "agile", "prototyping",
  "wireframing", "usability testing", "html", "css", "strategic planning",
];
const stopWords = new Set(["the", "and", "for", "with", "you", "our", "are", "this", "that", "from", "will", "have", "has", "years"]);

function tokens(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [])
      .map((word) => word.replace(/^\.+|\.+$/g, ""))
      .filter((word) => word.length > 2 && !stopWords.has(word)),
  );
}

function extractGaps(description: string, resume: string, profile: Profile): string[] {
  const job = tokens(description);
  const source = tokens(`${resume}\n${profile.skills.join(" ")}`);
  const gaps = skillVocabulary
    .filter((skill) => {
      const skillWords = [...tokens(skill)];
      return skillWords.length > 0 && skillWords.every((word) => job.has(word)) && !skillWords.every((word) => source.has(word));
    })
    .map((skill) => `Potential gap: the posting mentions “${skill},” which isn't present in your profile or resume.`);
  const required = description.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years|yrs)\s+(?:of\s+)?(?:relevant\s+)?experience/i);
  if (
    required &&
    profile.maxYearsExperience !== null &&
    Number(required[1]) > profile.maxYearsExperience
  ) {
    gaps.push(`Potential experience gap: the posting asks for ${required[1]} years; your selected role requirement limit is ${profile.maxYearsExperience} years.`);
  }
  return gaps;
}

function prioritizeOriginalText(text: string, jobText: string): string {
  const lines = text.split(/\n/);
  const relevantWords = tokens(jobText);
  const heading = /^(?:summary|profile|experience|employment|skills|projects|education|certifications|awards|selected work)\b/i;
  const firstHeading = lines.findIndex((line) => heading.test(line.trim()));
  const headerEnd = firstHeading >= 0 ? firstHeading : Math.min(3, lines.length);
  const header = lines.slice(0, headerEnd);
  const content = lines.slice(headerEnd).map((line, index) => ({ line, index }));
  const groups: Array<Array<{ line: string; index: number }>> = [];
  for (const item of content) {
    if (heading.test(item.line.trim()) || groups.length === 0) groups.push([]);
    groups[groups.length - 1]!.push(item);
  }
  const scoreGroup = (group: Array<{ line: string; index: number }>) =>
    group.reduce(
      (total, item) => total + [...tokens(item.line)].filter((word) => relevantWords.has(word)).length,
      0,
    );
  const prioritized = groups
    .map((items, index) => ({ items, index, score: scoreGroup(items) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .flatMap(({ items }) => items.map((item) => item.line));
  return [...header, ...prioritized].join("\n");
}

export interface DraftMaterial {
  originalResume: string;
  tailoredResume: string;
  gaps: string[];
  answers: Array<{ question: string; answer: string }>;
  coverLetter: string;
}

export function createDraft(
  job: { title: string; company: string; description: string },
  profile: Profile,
  originalResume: string,
): DraftMaterial {
  const tailoredResume = prioritizeOriginalText(originalResume, `${job.title} ${job.description}`);
  const relevantLines = originalResume
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 30)
    .map((line) => ({
      line,
      score: [...tokens(line)].filter((word) => tokens(`${job.title} ${job.description}`).has(word)).length,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => item.line);
  const evidence = relevantLines.length
    ? relevantLines.map((line) => `• ${line}`).join("\n")
    : "[Add a relevant, truthful example from your resume.]";
  const coverLetter = profile.coverLetterTemplate
    ? `${profile.coverLetterTemplate.trim()}\n\nFor this ${job.title} role at ${job.company}, relevant experience from my resume includes:\n${evidence}`
    : `Dear Hiring Team,\n\nI’m interested in the ${job.title} role at ${job.company}. Relevant experience from my resume includes:\n${evidence}\n\nI’d welcome the opportunity to discuss how this experience could contribute to your team.\n\nBest,\n${profile.fullName || "[Your name]"}`;
  return {
    originalResume,
    tailoredResume,
    gaps: extractGaps(job.description, originalResume, profile),
    answers: [],
    coverLetter,
  };
}
