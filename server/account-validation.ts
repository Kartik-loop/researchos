import { z } from "zod";
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters for your password.")
  .max(128);
export const tokenSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "This link is invalid. Please request a new one.");
export const verificationRequired = () =>
  process.env.EMAIL_VERIFICATION_REQUIRED === "true";
