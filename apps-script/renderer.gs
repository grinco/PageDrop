/**
 * PageDrop renderer web app.
 * Serves an HTML file stored in Drive (by file id) as a fully rendered page.
 * Deploy: Extensions > Apps Script > Deploy > New deployment > Web app.
 *   - Execute as: Me
 *   - Who has access: Anyone within <your domain>
 */
function doGet(e) {
  var id = e && e.parameter ? e.parameter.id : null;
  if (!id) {
    return HtmlService.createHtmlOutput("<h1>PageDrop</h1><p>Missing ?id parameter.</p>");
  }
  try {
    var file = DriveApp.getFileById(id);
    var html = file.getBlob().getDataAsString();
    return HtmlService.createHtmlOutput(html)
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .setTitle(file.getName());
  } catch (err) {
    return HtmlService.createHtmlOutput(
      "<h1>PageDrop</h1><p>Could not load that page. It may not exist or you may not have access.</p>"
    );
  }
}
