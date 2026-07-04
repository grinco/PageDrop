/**
 * PageDrop publisher web app (doPost).
 *
 * The one endpoint the MCP server calls. It performs all Drive writes/reads
 * under the deploying account's authorization — no GCP OAuth client required.
 *
 * Deploy: Extensions > Apps Script > Deploy > New deployment > Web app.
 *   - Execute as: Me
 *   - Who has access: Anyone            <-- anonymous; the secret is the gate
 *
 * Script Properties (Project Settings > Script Properties):
 *   - PAGEDROP_PUBLISH_SECRET  (required) shared secret; must match the MCP server.
 *   - PAGEDROP_FOLDER_NAME     (optional) defaults to "PageDrop".
 *   - PAGEDROP_DOMAIN          (optional) if set, sharing is domain-restricted.
 *
 * Wire contract: request/response are JSON.
 *   request : { secret, action, ...fields }
 *   success : { ok:true,  data:{...} }
 *   failure : { ok:false, error:{ code, message } }
 * Every response is HTTP 200; errors are carried in the envelope.
 */

var TYPE_PREFIX = 'pagedrop-type: ';

function doPost(e) {
  try {
    var body = parseBody_(e);
    if (body === null) return fail_('bad_request', 'request body is not valid JSON');

    if (!authorized_(body.secret)) return fail_('unauthorized', 'invalid or missing secret');

    switch (body.action) {
      case 'publish': return ok_(publish_(body));
      case 'update': return ok_(update_(body));
      case 'list': return ok_(list_());
      case 'search': return ok_(search_(body));
      case 'setSharing': return ok_(setSharing_(body));
      default: return fail_('bad_request', 'unknown action: ' + body.action);
    }
  } catch (err) {
    if (err && err.pagedropCode) return fail_(err.pagedropCode, err.message);
    return fail_('internal', String(err && err.message ? err.message : err));
  }
}

/* ---- actions ---- */

function publish_(body) {
  if (!body.title) throw coded_('bad_request', 'title is required');
  var type = body.type || 'page';
  var folder = ensureFolder_();
  var file = folder.createFile(body.title + '.html', body.html || '', MimeType.HTML);
  file.setDescription(TYPE_PREFIX + type);
  var sharing = applySharing_(file, body.scope);
  return {
    id: file.getId(),
    type: type,
    name: file.getName(),
    createdAt: file.getDateCreated().toISOString(),
    sharing: sharing
  };
}

function update_(body) {
  if (!body.id) throw coded_('bad_request', 'id is required');
  var file = getFileOrNotFound_(body.id);
  file.setContent(body.html || '');
  if (body.title) file.setName(body.title + '.html');
  return { id: file.getId(), name: file.getName() };
}

function list_() {
  var folder = ensureFolder_();
  return { items: filesToItems_(folder.getFiles()) };
}

function search_(body) {
  var folder = ensureFolder_();
  var q = 'fullText contains "' + escapeQuery_(body.query || '') + '"';
  return { items: filesToItems_(folder.searchFiles(q)) };
}

function setSharing_(body) {
  if (!body.id) throw coded_('bad_request', 'id is required');
  var file = getFileOrNotFound_(body.id);
  var sharing = applySharing_(file, body.scope);
  return { id: file.getId(), scope: sharing };
}

/* ---- helpers ---- */

function applySharing_(file, scope) {
  if (scope && scope !== 'domain') throw coded_('unsupported', 'sharing scope not supported: ' + scope);
  var domain = prop_('PAGEDROP_DOMAIN');
  if (domain) {
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    return 'domain';
  }
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'public';
}

function filesToItems_(iter) {
  var items = [];
  while (iter.hasNext()) {
    var f = iter.next();
    items.push({
      id: f.getId(),
      title: stripHtmlExt_(f.getName()),
      type: typeOf_(f),
      createdAt: f.getDateCreated().toISOString(),
      modifiedAt: f.getLastUpdated().toISOString()
    });
  }
  return items;
}

function typeOf_(file) {
  var desc = file.getDescription();
  if (desc && desc.indexOf(TYPE_PREFIX) === 0) return desc.substring(TYPE_PREFIX.length).trim();
  return 'page';
}

function ensureFolder_() {
  var name = prop_('PAGEDROP_FOLDER_NAME') || 'PageDrop';
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function getFileOrNotFound_(id) {
  try {
    return DriveApp.getFileById(id);
  } catch (err) {
    throw coded_('not_found', 'no such file: ' + id);
  }
}

function parseBody_(e) {
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
}

function authorized_(provided) {
  var expected = prop_('PAGEDROP_PUBLISH_SECRET');
  if (!expected) return false; // fail closed: no secret configured
  return secretsMatch_(provided, expected);
}

// Length-checked constant-time comparison (GAS has no timingSafeEqual).
function secretsMatch_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function stripHtmlExt_(name) {
  return name.replace(/\.html$/i, '');
}

function escapeQuery_(q) {
  return String(q).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function coded_(code, message) {
  var err = new Error(message);
  err.pagedropCode = code;
  return err;
}

function ok_(data) {
  return json_({ ok: true, data: data });
}

function fail_(code, message) {
  return json_({ ok: false, error: { code: code, message: message } });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
