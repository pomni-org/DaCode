'use strict';

const TOKEN_TYPES = ['keyword', 'type', 'function', 'class', 'variable', 'string', 'number', 'comment', 'operator', 'property'];

class LanguageModel {
  constructor(spec) { this.update(spec); }
  update(spec) {
    this.spec=spec;
    this.keywords=new Set(spec.keywords||[]);
    this.literals=new Set(spec.literals||[]);
    this.types=new Set([...(spec.types?.direct||[]),...(spec.types?.compound||[]),...(spec.types?.subtypes||[])]);
    this.builtins=new Set(spec.builtins||[]);
    this.special=new Set(spec.specialIdentifiers||[]);
    this.operators=[...(spec.operators||[])].sort((a,b)=>b.length-a.length);
    this.comment=spec.comments?.line||'#';
    this.blockComment=spec.comments?.block||['"""','"""'];
    this.quotes=new Set(spec.strings?.quotes||['"',"'"]);
    this.smartPrefix=spec.strings?.smartPrefix||'w';
  }
  completionItems(){return this.spec.completion||[];}
  hover(word){return this.spec.hover?.[word]||null;}

  tokens(text){
    const result=[];
    const lines=String(text).split(/\r?\n/);
    let inBlock=false;
    for(let line=0;line<lines.length;line++) inBlock=this._lineTokens(lines[line],line,result,inBlock);
    return result;
  }

  _lineTokens(source,line,out,inBlock){
    let i=0, afterRemem=false;
    const [blockStart,blockEnd]=this.blockComment;
    while(i<source.length){
      if(inBlock){
        const end=source.indexOf(blockEnd,i);
        if(end<0){out.push({line,start:i,length:source.length-i,type:'comment'});return true;}
        out.push({line,start:i,length:end+blockEnd.length-i,type:'comment'});
        i=end+blockEnd.length; inBlock=false; continue;
      }
      if(source.startsWith(blockStart,i)){
        const end=source.indexOf(blockEnd,i+blockStart.length);
        if(end<0){out.push({line,start:i,length:source.length-i,type:'comment'});return true;}
        out.push({line,start:i,length:end+blockEnd.length-i,type:'comment'});
        i=end+blockEnd.length; continue;
      }
      const ch=source[i];
      if(/\s/.test(ch)){i++;continue;}
      if(source.startsWith(this.comment,i)){out.push({line,start:i,length:source.length-i,type:'comment'});break;}
      if(ch===this.smartPrefix&&this.quotes.has(source[i+1])){
        const end=scanString(source,i+1);out.push({line,start:i,length:end-i,type:'string'});i=end;afterRemem=false;continue;
      }
      if(this.quotes.has(ch)){
        const end=scanString(source,i);out.push({line,start:i,length:end-i,type:'string'});i=end;afterRemem=false;continue;
      }
      const number=source.slice(i).match(/^\d+(?:\.\d+)?/);
      if(number){out.push({line,start:i,length:number[0].length,type:'number'});i+=number[0].length;afterRemem=false;continue;}
      const word=source.slice(i).match(/^[\p{L}_][\p{L}\p{N}_]*/u);
      if(word){
        const value=word[0]; let type='variable';
        if(this.keywords.has(value)||this.literals.has(value)||this.special.has(value)) type='keyword';
        else if(this.types.has(value)||(value==='float'&&source.slice(Math.max(0,i-5),i)==='numb.')) type='type';
        else if(this.builtins.has(value)) {
          const rest=source.slice(i+value.length).trimStart();
          type=rest.startsWith('=')?'variable':'function';
        }
        if(afterRemem&&type==='variable'){
          const rest=source.slice(i+value.length).trimStart();
          if(rest.startsWith('(')) type='function';
          else if(rest.startsWith(':')) type='class';
          afterRemem=false;
        }
        out.push({line,start:i,length:value.length,type});
        if(value==='remem'||value==='remember') afterRemem=true;
        else if(type!=='type'&&value!=='block') afterRemem=false;
        i+=value.length;continue;
      }
      let op=null;
      for(const candidate of this.operators){if(source.startsWith(candidate,i)){op=candidate;break;}}
      if(op){out.push({line,start:i,length:op.length,type:'operator'});i+=op.length;continue;}
      i++;
    }
    return inBlock;
  }
}
function scanString(source,quoteIndex){
  const quote=source[quoteIndex];let i=quoteIndex+1,escaped=false;
  while(i<source.length){
    if(escaped) escaped=false;
    else if(source[i]==='\\') escaped=true;
    else if(source[i]===quote) return i+1;
    i++;
  }
  return source.length;
}
module.exports={LanguageModel,TOKEN_TYPES};
