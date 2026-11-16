import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyImportChapters} from '../learning/import-service.mjs';

test('later prose referring to an earlier chapter does not become another chapter',()=>{
  const pages=Array.from({length:60},(_,i)=>({number:i+1,text:'Self-authored body text.'}));
  for(let chapter=1;chapter<=5;chapter++)pages[(chapter-1)*10].text=`第${chapter}章 主题${chapter}\n本章的自编正文。`;
  pages[20].text='第3章，”主题3\n本章自编正文。';
  pages[55].text='正文续页\n第二章 中的例子，可以用来解释本节的概念。\n后续正文。';
  const found=identifyImportChapters({pages,method:'pdf-text'});
  assert.equal(found.chapters.length,5);
  assert.deepEqual(found.chapters.map(c=>c.startPage),[1,11,21,31,41]);
  assert.equal(found.chapters.at(-1).endPage,60);
});

test('repeated genuine running headings retain one chapter; a new volume reset remains ambiguous',()=>{
  const pages=[{number:1,text:'Chapter 1: Units\nSource body.'},{number:2,text:'Chapter 1: Units\nSource continuation.'},{number:3,text:'Chapter 2: Addition\nSource body.'}];
  assert.equal(identifyImportChapters({pages,method:'pdf-text'}).chapters.length,2);
  pages.push({number:4,text:'Volume II\nChapter 1: A different topic\nSource body.'});
  assert.equal(identifyImportChapters({pages,method:'pdf-text'}).chapters.length,0);
});

test('a real missing chapter sequence still requires review',()=>{
  const pages=[{number:1,text:'Chapter 1: Units\nSource body.'},{number:2,text:'Chapter 3: Comparison\nSource body.'}];
  assert.equal(identifyImportChapters({pages,method:'pdf-text'}).chapters.length,0);
});

test('answers and index after the last physical chapter remain nonchapter material',()=>{
  const pages=Array.from({length:50},(_,i)=>({number:i+1,text:'Self-authored body text.'}));
  pages[0].text='第一章 定义\n自编正文';pages[20].text='第二章 推导\n自编正文';
  pages[40].text='习题答案\n自编答案';pages[44].text='索引\n自编检索词';
  const found=identifyImportChapters({pages,method:'pdf-text'});
  assert.deepEqual(found.chapters.map(chapter=>[chapter.startPage,chapter.endPage]),[[1,20],[21,40]]);
  pages[40].text='这里提到习题答案，但这不是独立的目录标题。';pages[44].text='正文仍在继续。';
  assert.equal(identifyImportChapters({pages,method:'pdf-text'}).chapters.at(-1).endPage,50);
});
