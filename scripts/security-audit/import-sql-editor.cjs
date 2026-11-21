'use strict';
const LIMIT = 10 * 1024 * 1024;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function reject() { throw Error('Unsupported SQL Editor export'); }
function parseCsv(text) {
  // Strict comma-delimited CSV: doubled quotes, quoted newlines, LF or CRLF.
  const rows=[];let row=[],field='',state='start';
  function cell(){row.push(field);field='';state='start';if(row.length>1)reject();}
  function record(){cell();rows.push(row);row=[];if(rows.length>3)reject();}
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(state==='quoted') {
      if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else state='closed';}
      else field+=ch;
    } else if(ch==='\n'||ch==='\r') {
      if(ch==='\r'){if(text[i+1]!=='\n')reject();i++;}record();
    } else if(ch===','){cell();}
    else if(ch==='"'){if(state!=='start')reject();state='quoted';}
    else {if(state==='closed')reject();field+=ch;state='plain';}
  }
  if(state==='quoted')reject();
  if(field!==''||row.length||state!=='start')record();
  if(rows.length!==2||!rows[0][0].trim()||!rows[1][0].trim())reject();
  return rows[1][0];
}
function unwrap(value) {
  if(object(value)&&Object.hasOwn(value,'formatVersion'))return value;
  if(!Array.isArray(value)||value.length!==1||!object(value[0]))reject();
  const keys=Object.keys(value[0]);if(keys.length!==1)reject();
  let cell=value[0][keys[0]];
  if(typeof cell==='string')cell=JSON.parse(cell);
  if(!object(cell)||!Object.hasOwn(cell,'formatVersion'))reject();
  return cell;
}
function importSqlEditor(input) {
  if(typeof input!=='string'||Buffer.byteLength(input,'utf8')>LIMIT)reject();
  const text=input.replace(/^\uFEFF/,'').trim();
  if(!text)reject();
  if(text.startsWith('{')||text.startsWith('['))return unwrap(JSON.parse(text));
  const payload=JSON.parse(parseCsv(text));
  if(!object(payload)||!Object.hasOwn(payload,'formatVersion'))reject();
  return payload;
}
module.exports={importSqlEditor,parseCsv,LIMIT};
