// Prints how many pages and characters a PDF has and a few lines of one page: node tsx scripts/languages/probe.ts file.pdf [page]
import { pdfPages } from "../../src/features/languages/pdf.server";
const pages = await pdfPages(process.argv[2]!);
console.log(pages.length, "pages;", pages.join("").length, "chars");
console.log(pages[Number(process.argv[3] ?? 5)]?.split("\n").slice(0, 14).join("\n"));
