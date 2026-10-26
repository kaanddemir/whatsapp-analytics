/** Frozen bilingual synthetic evaluation. Final is run once, outside the unit suite.
 * vite-node scripts/language/evaluate.ts dev|final output.json [--model]
 * Run --model through benchmarks/guard.ts; local verified e5 files only. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detect, type Behaviour } from "@/behaviour/rules";
import { route } from "@/ask/router";
import { answer, type SemanticInput } from "@/ask/answer";
import { ChatSession } from "@/conversation/session";
import { parseExport } from "@/parser";
import { NO_FILTERS } from "@/model";
import { android, lines } from "../../tests/support/export";
import { E5_SMALL } from "@/semantic/model";
import { meaningText } from "@/semantic/query";
import { VectorIndex } from "@/semantic/vectors";
import { pipelineEmbedder, type FeatureExtractor, type Embedder } from "@/semantic/embedder";

type B = { lang: string; behaviour: Behaviour; text: string; label: boolean; style: string; prev?: string };
type R = { lang: string; question: string; expected: Record<string, unknown> };
type C = { texts: string[]; senders: number[]; minutes: number[]; gold: number[] };
type S = { question: string; lang: string; factLang: string; texts: string[]; gold: number[]; answerable: boolean };
const [mode, output] = process.argv.slice(2);
if (!['dev', 'final'].includes(mode!) || !output) throw Error('Expected dev|final output.json [--model]');
const fixture = new URL(`../../tests/fixtures/language/${mode}.json`, import.meta.url);
const raw = readFileSync(fixture);
const hash = createHash('sha256').update(raw).digest('hex');
const integrity = JSON.parse(readFileSync(new URL('../../tests/fixtures/language/integrity.json', import.meta.url), 'utf8'));
if (mode === 'final' && (hash !== integrity.sha256 || existsSync(output) || resolve(output) !== fileURLToPath(new URL('./results/final.json', import.meta.url)))) throw Error('Final integrity or once-only output check failed');
const data = JSON.parse(raw.toString()) as { now: string; behaviour: B[]; router: R[]; context: C[]; retrieval: S[] };
const now = Date.parse(data.now);
const parse = (texts: string[], senders = texts.map((_, i) => i % 2), minutes = texts.map((_, i) => i)) => parseExport(lines(...texts.map((t, i) => android('12/04/24', `${String(Math.floor(minutes[i]! / 60) % 24).padStart(2,'0')}:${String(minutes[i]! % 60).padStart(2,'0')}`, senders[i] === 0 ? 'Ayşe Yılmaz' : senders[i] === 1 ? 'Can' : 'Deniz', t))));
const fraction = (n: number, total: number) => ({ correct: n, n: total, rate: total ? n / total : null });
const mean = (xs: number[]) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const subset = (actual: unknown, gold: unknown): boolean => gold !== null && typeof gold === 'object' ? Object.entries(gold).every(([k,v])=>subset((actual as Record<string, unknown> | null)?.[k],v)) : actual === gold;
const b = data.behaviour.map(c=>({...c,pred:detect(c.behaviour,c.text,{prevOther:c.prev})}));
const score = (rs: typeof b) => {
 const tp=rs.filter(c=>c.label&&c.pred).length, fp=rs.filter(c=>!c.label&&c.pred).length, fn=rs.filter(c=>c.label&&!c.pred).length;
 const p=tp+fp?tp/(tp+fp):0, r=tp+fn?tp/(tp+fn):0;
 return { n:rs.length,tp,fp,fn,precision:p,recall:r,f1:p+r?2*p*r/(p+r):0 };
};
const cells=Object.fromEntries(['tr','en'].flatMap(lang=>['proposal','acceptance','apology','cancellation'].map(behaviour=>{
 const rs=b.filter(c=>c.lang===lang&&c.behaviour===behaviour), all=score(rs), formal=score(rs.filter(c=>c.style==='formal')), informal=score(rs.filter(c=>c.style==='informal'));
 const precisionGap=Math.abs(formal.precision-informal.precision), recallGap=Math.abs(formal.recall-informal.recall);
 return [`${behaviour}.${lang}`,{...all,formal,informal,precisionGap,recallGap,passes:all.precision>=.9&&all.recall>=.8&&precisionGap<=.1&&recallGap<=.1}];
})));
const base = parse(['merhaba','selam']);
const routed=data.router.map(c=>({...c,actual:route(c.question,base.participants,now)}));
const routerBy=Object.fromEntries(['tr','en','mixed'].map(lang=>{
 const rs=routed.filter(c=>c.lang===lang), entities=rs.filter(c=>'person' in c.expected), dates=rs.filter(c=>'period' in c.expected), unsupported=rs.filter(c=>c.expected.type==='unsupported'||'limitation' in c.expected);
 return [lang,{intent:fraction(rs.filter(c=>c.actual.type===c.expected.type).length,rs.length),operation:fraction(rs.filter(c=>subset(c.actual,c.expected)).length,rs.length),person:fraction(entities.filter(c=>subset(c.actual,{person:c.expected.person})).length,entities.length),period:fraction(dates.filter(c=>subset(c.actual,{period:c.expected.period})).length,dates.length),unsupported:fraction(unsupported.filter(c=>subset(c.actual,c.expected)).length,unsupported.length)}];
}));
const contextual=data.context.map(c=>{
 const parsed=parse(c.texts,c.senders);
 // Set elapsed time directly: export day labels must not fold a >24-hour gap back into the same day.
 parsed.messages.forEach((m,i)=>{(m as {ts:number}).ts=Date.UTC(2024,3,12)+c.minutes[i]!*60_000;});
 const session=new ChatSession(parsed), actual=[...session.behaviourMatches().flags].flatMap((f,i)=>f&2?[i]:[]);
 return {...c,actual,correct:JSON.stringify(actual)===JSON.stringify(c.gold)};
});
const exact = routed.filter(c=>c.expected.type==='statistic'&&c.expected.metric==='message_count').map(c=>{
 // Independent oracle over a five-row chat, no production analytics or date helper.
 const rows=[['2024-04-12','Ayşe Yılmaz','hello'],['2024-04-12','Can','hi'],['2024-04-13','Can','later'],['2025-02-01','Ayşe Yılmaz','new'],['2025-02-02','Can','year']];
 const parsed=parseExport(lines(...rows.map(([d,n,t])=>android(`${d!.slice(8,10)}/${d!.slice(5,7)}/${d!.slice(2,4)}`,'09:00',n!,t!))));
 const period=c.expected.period as {start:string;end:string}|undefined, person=c.expected.person;
 const expected=c.expected.kind ? 0 : rows.filter(([d,n])=>(!period||(d!>=period.start&&d!<=period.end))&&(person===undefined||person===null||n===base.participants[Number(person)]?.name)).length;
 const a=answer(c.question,new ChatSession(parsed),NO_FILTERS,undefined,c.lang==='tr'?'tr':'en',null,now);
 return {question:c.question,lang:c.lang,expected,actual:a.figure?.value??null,correct:subset(a.plan,c.expected)&&a.basis==='count'&&Number(a.figure?.value)===expected};
});
let embedder: Embedder|null=null;
if(process.argv.includes('--model')) {
 const root=process.env.SEMANTIC_MODELS_DIR??join(homedir(),'.cache','wa-phase2','models');
 for(const f of E5_SMALL.files) if(createHash('sha256').update(readFileSync(join(root,E5_SMALL.repo,f.path))).digest('hex')!==f.sha256) throw Error(`Unverified local model ${f.path}`);
 const {pipeline,env}=await import('@huggingface/transformers'); env.allowRemoteModels=false;env.useFSCache=false;env.localModelPath=root+'/';
 const fe=await pipeline('feature-extraction',E5_SMALL.repo,{dtype:E5_SMALL.dtype,device:'cpu',session_options:{intraOpNumThreads:1,enableCpuMemArena:false} as never});
 embedder=pipelineEmbedder(fe as unknown as FeatureExtractor,E5_SMALL,'cpu');
}
const retrieval: (S & {shown:number[];r1:number;r5:number;r10:number;qualified:boolean;text:string;note:string|null})[]=[];
try {
 for(const c of data.retrieval){
 const parsed=parse(c.texts), session=new ChatSession(parsed);
 let semantic:SemanticInput|null=null;
 if(embedder){
 const index=new VectorIndex(E5_SMALL.dim);index.add(c.texts.map((_,i)=>i),await embedder.embed(c.texts.map(t=>E5_SMALL.passagePrefix+t)));
 const qv=await embedder.embed([E5_SMALL.queryPrefix+meaningText(c.question)]);
 semantic={search:keep=>index.search(qv,200,keep),similarity:id=>index.score(qv,id),lexicalWeight:E5_SMALL.lexicalWeight,minSimilarity:E5_SMALL.minSimilarity,coverage:1,status:'ready'};
 }
 const a=answer(c.question,session,NO_FILTERS,undefined,c.lang==='tr'?'tr':'en',semantic,now), shown=a.evidence.map(e=>e.message.id);
 const rank=shown.findIndex(id=>c.gold.includes(id));
 retrieval.push({...c,shown,r1:+(rank===0),r5:+(rank>=0&&rank<5),r10:+(rank>=0&&rank<10),qualified:!a.supported||a.evidence.length===0||!!a.note,text:a.text,note:a.note});
 }
} finally {await embedder?.dispose();}
const groups=Object.fromEntries(['tr->tr','en->en','tr->en','en->tr'].map(pair=>{
 const rs=retrieval.filter(c=>`${c.lang}->${c.factLang}`===pair&&c.answerable);
 return [pair,{n:rs.length,recall1:mean(rs.map(c=>c.r1)),recall5:mean(rs.map(c=>c.r5)),recall10:mean(rs.map(c=>c.r10)),evidenceTop1:rs.filter(c=>c.r1).length}];
}));
const negatives=retrieval.filter(c=>!c.answerable);
const report={mode,fixtureSha256:hash,model:embedder?E5_SMALL.repo:'none (keyword only)',at:new Date().toISOString(),behaviour:cells,router:routerBy,context:fraction(contextual.filter(c=>c.correct).length,contextual.length),exactAnswers:Object.fromEntries(['tr','en','mixed'].map(l=>{const rs=exact.filter(c=>c.lang===l);return[l,fraction(rs.filter(c=>c.correct).length,rs.length)];})),retrieval:groups,negatives:{n:negatives.length,showingEvidence:negatives.filter(c=>c.shown.length).length,qualified:negatives.filter(c=>c.qualified).length},failures:{behaviour:b.filter(c=>c.label!==c.pred),router:routed.filter(c=>!subset(c.actual,c.expected)),context:contextual.filter(c=>!c.correct),exact:exact.filter(c=>!c.correct),retrieval:retrieval.filter(c=>c.answerable&&!c.r1)},cases:{exact,retrieval}};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:mode==='final'?'wx':'w'});
console.log(JSON.stringify({...report,failures:undefined,cases:undefined}));
