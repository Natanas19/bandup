import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "BandUp",
  description: "Um espaço para sua banda crescer.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <Script id="pre-hydration-error-capture" strategy="beforeInteractive">
          {`(function () {
            function showReport(type, message, file, line, column, stack) {
              var details = "Tipo: " + (type || "desconhecido") +
                "\\nMensagem: " + (message || "sem mensagem") +
                "\\nArquivo/URL: " + (file || "indisponível") +
                "\\nLinha: " + (line || "indisponível") +
                "\\nColuna: " + (column || "indisponível");

              if (stack) details += "\\n\\nStack: " + stack;
              window.alert(details);
            }

            window.onerror = function (message, file, line, column, error) {
              showReport(
                error && error.name ? error.name : "Erro JavaScript",
                message,
                file,
                line,
                column,
                error && error.stack
              );
              return false;
            };

            window.addEventListener("error", function (event) {
              var target = event.target;
              if (target && target.tagName && target.tagName.toLowerCase() === "script") {
                showReport(
                  "Falha ao carregar script",
                  "O navegador não conseguiu carregar este script.",
                  target.src || target.getAttribute("src"),
                  "",
                  "",
                  ""
                );
              }
            }, true);

            window.addEventListener("unhandledrejection", function (event) {
              var reason = event.reason;
              showReport(
                "Promise rejeitada sem tratamento",
                reason && reason.message ? reason.message : String(reason),
                reason && (reason.fileName || reason.sourceURL),
                reason && reason.lineNumber,
                reason && reason.columnNumber,
                reason && reason.stack
              );
            });

            window.alert("CAPTURA ARMADA");
          }());`}
        </Script>
        {children}
      </body>
    </html>
  );
}
