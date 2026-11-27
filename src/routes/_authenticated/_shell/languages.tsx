import { createFileRoute } from "@tanstack/react-router";
import { LanguagesPage } from "@/features/languages/LanguagesPage";

export const Route = createFileRoute("/_authenticated/_shell/languages")({
  head: () => ({ meta: [{ title: "Languages — Lifeplan" }] }),
  component: LanguagesPage,
});
