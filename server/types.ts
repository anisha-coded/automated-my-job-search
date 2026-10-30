export interface Profile {
  fullName: string;
  email: string;
  phone: string;
  targetRoles: string[];
  locations: string[];
  remotePreference: "any" | "remote" | "hybrid" | "onsite";
  salaryMin: number | null;
  salaryMax: number | null;
  minYearsExperience: number | null;
  maxYearsExperience: number | null;
  workAuthorization: string;
  excludedCompanies: string[];
  skills: string[];
  experience: Array<{ title: string; company: string; dates: string }>;
  achievements: string[];
  coverLetterTemplate: string;
}

export interface Job {
  id: string;
  source: string;
  company: string;
  title: string;
  location: string;
  description: string;
  url: string;
  postedAt: string | null;
  score: number;
  status: string;
  discoveredAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  submittedAt?: string | null;
  attemptState?: string | null;
}

export const emptyProfile: Profile = {
  fullName: "",
  email: "",
  phone: "",
  targetRoles: [],
  locations: [],
  remotePreference: "any",
  salaryMin: null,
  salaryMax: null,
  minYearsExperience: null,
  maxYearsExperience: null,
  workAuthorization: "",
  excludedCompanies: [],
  skills: [],
  experience: [],
  achievements: [],
  coverLetterTemplate: "",
};
