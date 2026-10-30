import mammoth from "mammoth";
import pdf from "pdf-parse";

export interface ParsedResume {
  text: string;
  skills: string[];
  experience: Array<{ title: string; company: string; dates: string }>;
  achievements: string[];
}

const knownSkills = [
  "javascript", "typescript", "react", "node.js", "python", "java", "sql", "figma",
  "product design", "user research", "accessibility", "project management", "data analysis",
  "machine learning", "aws", "communication", "leadership", "agile",
];

export async function parseResume(
  bytes: Buffer,
  mimeType: string,
  filename: string,
): Promise<ParsedResume> {
  let text: string;
  if (mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    text = (await pdf(bytes)).text;
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filename.toLowerCase().endsWith(".docx")
  ) {
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else {
    throw new Error("Resume must be a PDF or DOCX file.");
  }

  const normalized = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (!normalized) throw new Error("No readable text was found in the uploaded resume.");
  const lower = normalized.toLowerCase();
  const skills = knownSkills.filter((skill) => lower.includes(skill));
  const datePattern = /\b(?:19|20)\d{2}\s*(?:-|–|to|—)\s*(?:(?:19|20)\d{2}|present|current)\b/i;
  const experience = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => datePattern.test(line))
    .slice(0, 12)
    .map((line) => ({ title: line.replace(datePattern, "").trim(), company: "", dates: line.match(datePattern)?.[0] ?? "" }));
  const achievements = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[•*-]\s+/.test(line))
    .map((line) => line.replace(/^[•*-]\s+/, ""))
    .slice(0, 30);
  return { text: normalized, skills, experience, achievements };
}
