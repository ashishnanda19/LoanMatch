"""A tiny stand-in for the web API with realistic data, so the UI can be tested without AWS.
Run by ui/test/run.sh on port 8799; the access key it accepts is 'demo'."""
import json, re, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
LENDERS=[("Axis Bank",8.75,["Salaried"],None),("Bandhan Bank",8.86,["Salaried","Self-Employed","Business"],None),("Union Bank",8.90,["Salaried","Self-Employed","Business"],None),
 ("Indian Bank",9.00,["Salaried","Self-Employed","Business"],700),("Bank of Maharashtra",9.75,["Salaried","Self-Employed","Business"],None),("Punjab & Sind Bank",9.90,["Salaried"],None),
 ("Kotak Mahindra",9.95,["Salaried"],None),("Canara Bank",9.95,["Salaried"],None),("HDFC Bank",9.99,["Salaried","Self-Employed"],None),("ICICI Bank",9.99,["Salaried","Self-Employed"],None),
 ("SBI",10.0,["Salaried","Self-Employed"],None),("Bajaj Finance",10.0,["Salaried","Self-Employed","Business"],650)]
def lender(i,n):
    return {"product_id":i,"product_name":n[0]+" Personal Loan","lender":n[0],"source_site":"paisabazaar","rate":n[1],"types":n[2],"min_credit_score":n[3],"min_income":None,"min_age":21,"max_age":60,"last_crawled_at":"2026-10-20T06:00:00"}
def offers():
    out=[]
    for r,(n,rate,t,fl) in enumerate(LENDERS[:5],1):
        out.append({"match_rank":r,"product_name":n+" Personal Loan","lender":n,"rate":rate,"score_floor_own":None if r!=4 else 650,"score_floor_any":fl,"score_flag":False,
          "verdict":"conditional" if r in (2,3,5) else "eligible","caveat":["","You need 1 debit and 2 credit transactions a month in your main account.","You must be a permanent employee of a reputed organisation.","","Depends on being a permanent government, MNC or PSU employee."][r-1] or None,"notified_at":"2026-10-20T05:12:38"})
    return out
class H(BaseHTTPRequestHandler):
    def _send(self,code,obj):
        b=json.dumps(obj).encode(); self.send_response(code)
        for k,v in {"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-api-key","Access-Control-Allow-Methods":"GET,POST,OPTIONS"}.items(): self.send_header(k,v)
        self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): self._send(204,{})
    def do_GET(self):
        p=self.path.split("?")[0]
        if p=="/lenders": return self._send(200,{"lenders":[lender(i,n) for i,n in enumerate(LENDERS)]})
        if self.headers.get("x-api-key")!="demo": return self._send(401,{"error":"missing or wrong access key"})
        if p=="/summary":
            st={"pairs_naive":450000,"pairs_after_reconcile":340000,"pairs_after_stage1_envelope":266532,"pairs_after_stage2_exact_rules":255380,"matches_written":50000,"llm_calls_in_this_workflow":0}
            b={"batch_id":"1bb2818c-3286-4707-8769-8c64fe53747b","status":"matched","row_count":10000,"skipped_rows":0,"duplicate_rows":0,"uploaded_at":"2026-10-20T05:11:40","matched_at":"2026-10-20T05:12:20","match_stats":st}
            return self._send(200,{"latest_batch":b,"emails_sent_for_batch":10,"recent_batches":[b],"totals":{"users":10000,"matches":50000,"lenders":34,"last_crawl":"2026-10-20T06:00:00"},"notes":{"current":98,"total":101}})
        if p=="/users": return self._send(200,{"users":[{"user_id":"000745d7-667a-4ee1-bf15-ed1b7e57def6","name":"Saanvi Shaikh","employment_status":"Salaried"},{"user_id":"2","name":"Saanvi Rao","employment_status":"Business"}]})
        if p.startswith("/users/"): return self._send(200,{"user":{"user_id":"x","name":"Saanvi Shaikh","employment_status":"Salaried","monthly_income":61000,"credit_score":655,"age":50},"offers":offers(),"test_inbox":"a***+one@gmail.com"})
        self._send(404,{"error":"not found"})
    def do_POST(self):
        n=int(self.headers.get("Content-Length") or 0); body=json.loads(self.rfile.read(n) or b"{}")
        if self.path=="/match": return self._send(200,{"input":{**body,"monthly_income":int(body["monthly_income"]),"credit_score":int(body["credit_score"]),"age":int(body["age"])},"offers":offers()})
        self._send(404,{"error":"not found"})
    def log_message(self,*a): pass
HTTPServer(("127.0.0.1",8799),H).serve_forever()
