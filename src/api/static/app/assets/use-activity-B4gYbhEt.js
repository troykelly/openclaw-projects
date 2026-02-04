import{u as e}from"./error-state-DQEzcmEc.js";import{a as r}from"./api-client-CDvRtWmo.js";const i={all:["activity"],list:t=>[...i.all,"list",t]};function y(t=50){return e({queryKey:i.list(t),queryFn:({signal:a})=>r.get(`/api/activity?limit=${t}`,{signal:a})})}export{y as u};
//# sourceMappingURL=use-activity-B4gYbhEt.js.map
