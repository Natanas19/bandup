// Used only by the standalone visual test bundle, never imported by src/.
const MUSICIAN_PAGE_SIZE = 20;
const names = ['Ana Silva', 'Bruno Costa', 'Carla Souza', 'Diego Lima', 'Érica Santos',
  'Felipe Rocha', 'Gabriela Alves', 'Helena Martins', 'João Pedro', 'Luiza Melo',
  'Mariana de Albuquerque com um nome longo para testar quebra de linha', 'Ana Silva'];
const musicians = Array.from({ length: 47 }, (_, index) => ({
  name: `${names[index % names.length]}${index >= names.length ? ` ${Math.floor(index / names.length) + 1}` : ''}`,
  available: index % 3 !== 0,
}));
function page(query, offset, scenario = 'normal') {
  if (scenario === 'error') throw Error('Synthetic failure');
  const matches = scenario === 'empty' ? [] : musicians.filter(row => row.name.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')));
  return { musicians: matches.slice(offset, offset + MUSICIAN_PAGE_SIZE), hasNext: matches.length > offset + MUSICIAN_PAGE_SIZE };
}
module.exports = {
  MUSICIAN_PAGE_SIZE, MUSICIAN_DISCOVERY_ENABLED: true, page,
  getSupabaseBrowserClient() { return null; },
  async discoverMusicians(_client, query, offset, signal) {
    const scenario = document.getElementById('scenario').value;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(done, scenario === 'slow' ? 3000 : 450);
      function done() { signal.removeEventListener('abort', abort); resolve(); }
      function abort() { clearTimeout(timer); reject(Error('Aborted')); }
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
    if (signal.aborted) throw Error('Aborted');
    return page(query, offset, scenario);
  },
};
