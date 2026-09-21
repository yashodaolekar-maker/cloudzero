"""Record explicit authorization for synthetic pilot training without claiming expert review."""
import argparse, hashlib, json
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--input',type=Path,required=True); parser.add_argument('--output',type=Path,required=True); parser.add_argument('--authorization',required=True); args=parser.parse_args()
    if args.output.exists(): raise SystemExit('Refusing to overwrite an existing authorized dataset.')
    rows=[]
    for number,line in enumerate(args.input.read_text(encoding='utf-8-sig').splitlines(),1):
        if not line.strip(): continue
        row=json.loads(line); provenance=row['provenance']; digest=hashlib.sha256(f"{args.authorization}:{provenance['incidentId']}".encode()).hexdigest()
        row['trainingReady']=True; row.pop('exclusion',None)
        provenance.update(reviewerId='USER_AUTHORIZED_SYNTHETIC_PILOT',reviewEventId=f"PILOT-AUTH-{digest[:24]}",authorization=args.authorization,reviewStatus='AUTHORIZED_FOR_SIMULATION_PILOT_NOT_DOMAIN_VERIFIED')
        row['reviewNotice']='Authorized for an isolated simulation pilot. This is not expert validation or production promotion approval.'
        rows.append(row)
    args.output.parent.mkdir(parents=True,exist_ok=True); content=''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows); args.output.write_text(content,encoding='utf-8')
    print(json.dumps({'input':str(args.input),'output':str(args.output),'authorizedCases':len(rows),'sha256':hashlib.sha256(content.encode()).hexdigest(),'authorization':args.authorization}))

if __name__=='__main__': main()
