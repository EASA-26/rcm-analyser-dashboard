# RCM Genco

React/Vinext dashboard for digitising the RCM report workflow:

- upload the raw RCM Excel export in the browser;
- normalise it into the working-file `MainQuery` shape;
- calculate the same summary views used by the workbook;
- review existing vs revised maintenance plans online;
- export a PowerPoint report using the supplied sample deck as the template.

## Local Commands

```bash
npm ci
npm run dev
npm run build
```

The uploaded workbook is parsed client-side. Source spreadsheets are intentionally ignored by Git; the PowerPoint template needed by the app lives at `public/report-template.pptx`.
