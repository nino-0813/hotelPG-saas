// Optional isolated browser harness. Tools are installed outside this repository:
// npm install --prefix /tmp/hotelpg-browser-tools @playwright/test esbuild
// HOTELPG_TEST_TOOLS=/tmp/hotelpg-browser-tools node tests/browser-housekeeping.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const toolRoot=process.env.HOTELPG_TEST_TOOLS ?? '/tmp/hotelpg-browser-tools';
const require=createRequire(path.join(toolRoot,'package.json'));
const {build}=require('esbuild');
const {chromium,expect}=require('@playwright/test');
const root=process.cwd();
const out=fs.mkdtempSync(path.join(os.tmpdir(),'hotelpg-ui-'));
const artifactDir=path.join(root,'test-artifacts');
fs.mkdirSync(artifactDir,{recursive:true});
await build({stdin:{contents:`
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HousekeepingBoard} from './app/(dashboard)/housekeeping/housekeeping-board';
const room={room_number:'A',property:{name:'検証ホテル'}};
const stay={id:'stay',room_id:'room',guest_name:'テスト宿泊者',guest_count:2,check_in_date:'2030-01-01',check_out_date:'2030-01-04',check_in_time:'15:00',special_notes:null,room};
function App(){
 const [req,setReq]=useState(localStorage.getItem('requirement')||'unconfirmed');
 const [status,setStatus]=useState('todo');
 const task={id:'task',reservation_id:'stay',room_id:'room',type:'cleaning',status,assignee_id:null,scheduled_for:'2030-01-02T01:00:00Z',cleaning_date:'2030-01-02',cleaning_origin:'stay',cleaning_requirement:req,superseded_at:null,room,reservation:{...stay,check_out_time:'10:00'}};
 window.saveRequirement=async(id,date,value)=>{localStorage.setItem('requirement',value);setReq(value);return {ok:true}};
 window.saveTask=async(id,value)=>{setStatus(value);return {ok:true}};
 return <HousekeepingBoard tasks={[task]} checkIns={[]} stays={[stay]} staff={[]} selectedDate="2030-01-02" dateLabel="2030/01/02"/>;
}
createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root,loader:'tsx'},bundle:true,jsx:'automatic',outfile:path.join(out,'bundle.js'),plugins:[{name:'isolated-actions',setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'mock'}));
 b.onResolve({filter:/^\.\/actions$/},()=>({path:'actions',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='router'?'export const useRouter=()=>({push:()=>{}})':'export const setStayCleaningRequirement=(...args)=>window.saveRequirement(...args); export const updateCleaningTask=(...args)=>window.saveTask(...args);'}));
}}]});
// Use built project CSS when available; no external fonts or network requests.
let css='body{font-family:sans-serif;margin:0;color:#171717}button,select,input{font:inherit}';
const chunks=path.join(root,'.next/static/chunks');
if(fs.existsSync(chunks))for(const file of fs.readdirSync(chunks).filter(f=>f.endsWith('.css')))css+=fs.readFileSync(path.join(chunks,file),'utf8');
const server=http.createServer((req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(out,'bundle.js')));}
 else {res.setHeader('Content-Type','text/html');res.end(`<html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script></html>`);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin);
 const select=page.getByRole('combobox',{name:'A テスト宿泊者 本日の清掃'});
 await select.waitFor();assert.equal(await select.inputValue(),'unconfirmed');
 await select.selectOption('required');await page.getByRole('button',{name:'作業開始'}).waitFor();
 await page.screenshot({path:path.join(artifactDir,'housekeeping-required-desktop.png'),fullPage:true});
 await page.reload();assert.equal(await page.getByRole('combobox',{name:'A テスト宿泊者 本日の清掃'}).inputValue(),'required');
 await select.selectOption('not_required');await expect(page.getByRole('button',{name:'作業開始'})).toHaveCount(0);
 await page.reload();assert.equal(await select.inputValue(),'not_required');
 await select.selectOption('unconfirmed');
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(artifactDir,'housekeeping-unconfirmed-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await select.selectOption('required');
 await page.getByRole('button',{name:'作業開始'}).click();await expect(select).toBeDisabled();
 await page.getByRole('button',{name:'未完了に戻す'}).click();await expect(select).toBeEnabled();
 await page.getByRole('button',{name:'完了',exact:true}).click();
 await expect(select).toBeDisabled();
 await page.getByRole('button',{name:'未完了に戻す'}).click();await expect(select).toBeEnabled();
 assert.deepEqual(errors,[]);
 console.log('PASS: isolated Chromium desktop/mobile, requirement save/reload/change, completion/undo, no overflow or browser errors');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(out,{recursive:true,force:true});}
