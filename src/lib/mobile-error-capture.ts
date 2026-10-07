// TEMPORARY iOS 15 diagnosis. Remove this file and its import/script in layout.tsx.
// This is a native, parser-executed script: it never creates or updates DOM nodes.
export const mobileErrorCapture = String.raw`
(function () {
  if (window.__bandupErrorCaptureActive) return;
  window.__bandupErrorCaptureActive = true;
  window.__bandupErrors = window.__bandupErrors || [];
  var previousOnError = window.onerror;
  var shown = {};

  function describe(value) {
    try {
      if (value && value.stack) return String(value.stack);
      if (value && value.message) return String(value.message);
      if (typeof value === "string") return value;
      var json = JSON.stringify(value);
      return typeof json === "string" ? json : String(value);
    } catch (ignored) {
      return "Motivo nao serializavel";
    }
  }

  function record(kind, message, source, line, column, reason, scriptSrc) {
    var entry = {
      kind: kind,
      message: message || "Sem mensagem",
      source: source || "Nao informado",
      line: line == null ? "Nao informada" : line,
      column: column == null ? "Nao informada" : column,
      reason: reason || "",
      scriptSrc: scriptSrc || ""
    };
    window.__bandupErrors.push(entry);
    // Keep both native reports, but show one alert for the same error.
    var key = JSON.stringify([entry.message, entry.source, entry.line,
      entry.column, entry.reason, entry.scriptSrc]);
    if (shown[key]) return;
    shown[key] = true;
    window.setTimeout(function () {
      window.alert("BANDUP - CAPTURA NATIVA\n" +
        "Tipo: " + entry.kind + "\n" +
        "Mensagem: " + entry.message + "\n" +
        "Arquivo/source: " + entry.source + "\n" +
        "Linha: " + entry.line + "\n" +
        "Coluna: " + entry.column +
        (entry.reason ? "\nMotivo/stack: " + entry.reason : "") +
        (entry.scriptSrc ? "\nScript src: " + entry.scriptSrc : ""));
    }, 0);
  }

  window.onerror = function (message, source, line, column, error) {
    record("window.onerror", String(message), source, line, column,
      error ? describe(error) : "", "");
    if (typeof previousOnError === "function") {
      return previousOnError.apply(window, arguments);
    }
    return false;
  };

  window.addEventListener("error", function (event) {
    var target = event.target || event.srcElement;
    if (target && target.tagName && String(target.tagName).toLowerCase() === "script") {
      record("Falha de script", "Falha ao carregar script", target.src,
        null, null, "", target.src);
    } else if (event.message) {
      record("Evento error", String(event.message), event.filename,
        event.lineno, event.colno, event.error ? describe(event.error) : "", "");
    }
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    record("unhandledrejection", reason && reason.message ? String(reason.message) : describe(reason),
      reason && (reason.fileName || reason.sourceURL),
      reason && reason.lineNumber, reason && reason.columnNumber, describe(reason), "");
  });
})();
`;
