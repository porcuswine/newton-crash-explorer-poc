import { DAY_MS, dateDay, periodDays, validatePeriods } from './analysis.js';

export function addDays(date, days) {
  const day=dateDay(date);
  return Number.isFinite(day) && Number.isInteger(days) ? new Date((day+days)*DAY_MS).toISOString().slice(0,10) : null;
}

function calendarDate(year,month,day) {
  const last=new Date(0);last.setUTCFullYear(year,month,0);
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(Math.min(day,last.getUTCDate())).padStart(2,'0')}`;
}

export function shiftYears(date, years) {
  if(!Number.isFinite(dateDay(date)))return null;
  const [year,month,day]=date.split('-').map(Number);
  return calendarDate(year+years,month,day);
}

export function baselineEnd(bEnd, before='2020-01-01') {
  if(!Number.isFinite(dateDay(bEnd)) || !Number.isFinite(dateDay(before)))return null;
  const [,month,day]=bEnd.split('-').map(Number);
  let year=+before.slice(0,4),candidate=calendarDate(year,month,day);
  if(candidate>=before)candidate=calendarDate(year-1,month,day);
  return candidate;
}

export function equalizePeriods(a,b,{autoEnd=false,coverage}={}) {
  const bError=validatePeriods(b,b,coverage)?.replace(/^Period A/,'Period B');
  if(bError)return {a,b,error:bError};
  const end=autoEnd?baselineEnd(b.end):a.end;
  if(!Number.isFinite(dateDay(end)))return {a,b,error:'Enter an end date for Period A.'};
  const matched={start:addDays(end,1-periodDays(b)),end};
  if(matched.start<coverage.start)return {a:matched,b,error:`Equalizing requires Period A to start on ${matched.start}, before the available data (${coverage.start}). Shorten B or move A’s end forward.`};
  return {a:matched,b,error:validatePeriods(matched,b,coverage)};
}

export function defaultPeriods(coverage) {
  const b={start:shiftYears(coverage.end,-3),end:coverage.end};
  return equalizePeriods({end:baselineEnd(b.end)},b,{autoEnd:true,coverage});
}
