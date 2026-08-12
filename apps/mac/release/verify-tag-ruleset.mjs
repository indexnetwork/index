#!/usr/bin/env bun
const [raw,tag,id]=process.argv.slice(2);let r;try{r=JSON.parse(raw)}catch{process.exit(1)}
const glob=(pattern,value)=>{if(typeof pattern!=="string"||/[[\]{}\\]/.test(pattern))throw 0;let out="^";for(const c of pattern){if(c==="*")out+=".*";else if(c==="?")out+=".";else out+=c.replace(/[.+^$()|]/g,"\\$&")}return new RegExp(out+"$").test(value)};
try{const ref=`refs/tags/${tag}`,c=r.conditions?.ref_name;if(String(r.id)!==id||r.enforcement!=="active"||r.target!=="tag"||(r.bypass_actors?.length??0)!==0||!Array.isArray(c?.include)||!Array.isArray(c?.exclude)||!c.include.some(x=>x==="~ALL"||glob(x,ref))||c.exclude.some(x=>x==="~ALL"||glob(x,ref))||!r.rules?.some(x=>x.type==="update")||!r.rules?.some(x=>x.type==="deletion"))process.exit(1)}catch{process.exit(1)}
