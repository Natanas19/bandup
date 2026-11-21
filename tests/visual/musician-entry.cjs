/* eslint-disable @typescript-eslint/no-require-imports */
const React = require('react');
const { createRoot } = require('react-dom/client');
const Discovery = require('./generated-discovery.cjs').default;
function Preview() {
  const [revision, setRevision] = React.useState(0);
  return React.createElement('main', { className: 'workspace-theme min-w-0 min-h-screen px-4 py-6 sm:px-6 sm:py-12' },
    React.createElement('div', { className: 'mx-auto w-full max-w-5xl' },
      React.createElement('p', { className: 'text-sm text-danger' }, 'Prévia local isolada · Dados fictícios · Sem conexão com Supabase'),
      React.createElement('h1', { className: 'mt-3 text-3xl font-semibold text-content sm:text-4xl' }, 'Descobrir músicos'),
      React.createElement('p', { className: 'mt-3 text-sm text-content-muted' }, 'Explore os músicos cadastrados e veja quem está disponível para bandas.'),
      React.createElement('label', { htmlFor: 'scenario', className: 'mt-6 block text-content' }, 'Cenário da prévia'),
      React.createElement('select', { id: 'scenario', className: 'min-h-11 rounded-xl border p-3 text-black', onChange: () => setRevision(value => value + 1) },
        ...[['normal', 'Lista fictícia (47 músicos)'], ['slow', 'Carregamento lento (3 segundos)'], ['empty', 'Lista vazia'], ['error', 'Erro de carregamento']].map(([value, label]) => React.createElement('option', { key: value, value }, label))),
      React.createElement('label', { className: 'ml-4 text-content' },
        React.createElement('input', { type: 'checkbox', onChange: event => { document.documentElement.dataset.theme = event.target.checked ? 'dark' : 'light'; } }), ' Tema escuro'),
      React.createElement(Discovery, { key: revision })));
}
createRoot(document.getElementById('root')).render(React.createElement(Preview));
