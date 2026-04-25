import { state } from './state.js';

export function renderChart(ctx, labels, data){
  if(state.chart) state.chart.destroy();

  state.chart = new Chart(ctx,{
    type:'line',
    data:{
      labels,
      datasets:[{
        label:'Rain',
        data,
        borderWidth:2
      }]
    }
  });
}