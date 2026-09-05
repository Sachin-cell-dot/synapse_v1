import type { DistrictForecast, FutureGfsForecast } from '../types'
import { categoryForRainfall, displayRainfall, shortDate } from '../utils/rainfall'
import { RainfallChart } from './RainfallChart'

interface Props { record: DistrictForecast|null; history: DistrictForecast[]; historical:boolean; futureGfsForecast:FutureGfsForecast|null; districtName:string|null; onClose:()=>void }

function Source({name,value,weight,color}:{name:string;value:number|null;weight:number|null;color:string}) {
  return <div className="source-model" style={{'--source':color} as React.CSSProperties}>
    <div><span>{name}</span><b>{displayRainfall(value)}</b></div>
    <div><small>Adaptive trust</small><strong>{weight===null?'Not available':`${(weight*100).toFixed(1)}%`}</strong></div>
    <i><em style={{width:`${(weight??0)*100}%`}}/></i>
  </div>
}

export function DistrictPanel({record,history,districtName,onClose}:Props) {
  if(!record) return <aside className="district-panel card empty-panel panel-enter"><p className="eyebrow">District intelligence</p><h2>Select a district</h2><p>Click a district on the map or use search to inspect its forecast.</p></aside>
  const value=record.finalForecast, category=categoryForRainfall(value), operational=record.dataMode==='operational_forecast', reconstructed=record.dataMode==='archived_reconstruction'
  const total=(record.trustGfs??0)+(record.trustIfs??0)+(record.trustAifs??0)
  return <aside className="district-panel card panel-enter" key={`${record.district}-${record.date}`}>
    {districtName&&<button className="close-panel" onClick={onClose} aria-label="Close district panel">×</button>}
    <p className="eyebrow">{record.division} · #{record.districtCode}</p><h2>{record.district}</h2>
    <div className="hero-rain"><span>{operational?`SYNAPSE-WX OPERATIONAL DAY-${record.leadDays??'—'}`:reconstructed?'SYNAPSE-WX 24-HOUR FORECAST':'SYNAPSE-WX 24-HOUR HINDCAST'}</span><strong>{displayRainfall(value)}</strong><em>{category?.label??'Dry'}{record.confidence?` · ${record.confidence} agreement`:''}</em></div>
    <dl className="detail-list"><div><dt>Valid date</dt><dd>{shortDate(record.date)}</dd></div><div><dt>Model spread</dt><dd>{displayRainfall(record.modelAgreement)}</dd></div></dl>
    <div className="trust-total"><span>Adaptive trust mix</span><b>{(total*100).toFixed(1)}%</b></div>
    <div className="source-list"><Source name="GFS" value={record.gfs} weight={record.trustGfs} color="#4f9dff"/><Source name="IFS HRES" value={record.ifs} weight={record.trustIfs} color="#ffc46b"/><Source name="AIFS" value={record.aifs} weight={record.trustAifs} color="#a87cff"/></div>
    {!operational&&record.actualRainfall!==null&&<div className="verification-block"><p className="eyebrow">Verification only</p><small>Post-forecast IMD observation — never an input to this forecast</small><div><span>IMD realised rainfall <b>{displayRainfall(record.actualRainfall)}</b></span><span>Absolute error <b>{displayRainfall(record.absoluteError)}</b></span></div></div>}
    {reconstructed&&record.actualRainfall===null&&<div className="verification-block"><p className="eyebrow">Verification pending</p><small>No matching IMD realised-rainfall observation has been imported for this valid date.</small></div>}
    <h3>{operational||reconstructed?'Recent historical performance':'May–August performance'}</h3><RainfallChart records={history.filter((item)=>item.dataMode==='historical_hindcast')}/>
    <div className="trust-explanation"><b>Why this blend?</b><p>{record.trustExplanation}</p></div>
  </aside>
}
