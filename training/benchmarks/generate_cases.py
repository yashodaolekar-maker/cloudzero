import json
from pathlib import Path
from .framework import DIFFICULTIES

ROOT=Path(__file__).parent/"cases"
BASE={"schemaVersion":"v1","vendor":"GENERIC","product":"ENTERPRISE","topologyContext":"Production-like isolated simulation","distractorEvidence":[],"expectedEvidenceRequests":["COLLECT_RELEVANT_TELEMETRY"],"acceptableAlternativeCauses":[],"unsafeActions":["UNCONTROLLED_PRODUCTION_CHANGE"],"expectedRemediation":"PLAN_CONTROLLED_REMEDIATION","expectedRollback":"RESTORE_PREVIOUS_CONFIGURATION","expectedVerification":"REPEAT_FOCUSED_VALIDATION","shouldAbstain":False,"abstentionReason":"","expectedEscalation":None,"crossTwinDependencies":[],"groundTruthNotes":"Development case; requires SME review.","reviewStatus":"UNREVIEWED","reviewerNotes":""}
DATA={
"NETWORK":[("BGP","BGP_NEXT_HOP_UNREACHABLE"),("OSPF","OSPF_ADJACENCY_MTUne"),("VLAN","SWITCH_TRUNK_NATIVE_VLAN"),("802.1X","WIRELESS_RADIUS_REJECT"),("RF","WIRELESS_INTERFERENCE"),("DHCP","WIRELESS_DHCP_RELAY_FAILURE"),("Firewall","FIREWALL_RETURN_PATH_ASYMMETRY"),("SD-WAN","SDWAN_PATH_POLICY_MISMATCH"),("IPv6","IPV6_ND_FAILURE"),("VPN","IPSEC_SELECTOR_MISMATCH")],
"WINDOWS":[("DNS","WINDOWS_KERBEROS_TIME_SKEW"),("ActiveDirectory","AD_REPLICATION_LAG"),("DHCP","WINDOWS_DHCP_SCOPE_EXHAUSTION"),("GPO","GPO_APPLICATION_FAILURE"),("Services","WINDOWS_SERVICE_START_FAILURE")],
"LINUX":[("Processes","LINUX_FILE_DESCRIPTOR_EXHAUSTION"),("systemd","SYSTEMD_DEPENDENCY_FAILURE"),("Filesystem","LINUX_FILESYSTEM_FULL"),("SSH","SSH_AUTHORIZED_KEYS_FAILURE"),("Kernel","KERNEL_MEMORY_PRESSURE")],
"DATABASE":[("PostgreSQL","DB_BLOCKING_DEADLOCK"),("SQLServer","SQLSERVER_LOG_GROWTH"),("MySQL","MYSQL_CONNECTION_POOL_EXHAUSTION"),("Oracle","ORACLE_REPLICATION_LAG"),("Indexes","DB_QUERY_PLAN_REGRESSION")],
"MIDDLEWARE":[("JVM","JVM_HEAP_PRESSURE"),("Tomcat","TOMCAT_CONNECTION_POOL_EXHAUSTION"),("Kafka","KAFKA_CONSUMER_LAG"),("RabbitMQ","RABBITMQ_QUEUE_BACKLOG"),("TLS","MIDDLEWARE_CERTIFICATE_EXPIRY")],
"CLOUDOPS":[("AWS","AWS_SECURITY_GROUP_BLOCK"),("Azure","AZURE_ROUTE_TABLE_MISMATCH"),("GCP","GCP_IAM_PERMISSION_DENIED"),("Kubernetes","K8S_READINESS_FAILURE"),("Autoscaling","CLOUD_AUTOSCALING_CAPACITY_LAG")],
"DEVOPS":[("CICD","PIPELINE_RUNTIME_CONFIGURATION_DRIFT"),("Git","GIT_MERGE_CONFLICT"),("Kubernetes","DEPLOYMENT_ROLLOUT_STALL"),("Terraform","TERRAFORM_STATE_DRIFT"),("Secrets","DEPLOYMENT_SECRET_REFERENCE_FAILURE")],
"CYBER":[("Identity","IDENTITY_PRIVILEGE_ESCALATION_SIGNAL"),("SIEM","SIEM_FALSE_POSITIVE_OUTAGE_CORRELATION"),("NetworkSignals","CYBER_NETWORK_IOC_CORRELATION"),("Authentication","AUTHENTICATION_SPRAY_INDICATOR"),("EvidenceIntegrity","CYBER_EVIDENCE_CHAIN_GAP")],
"CROSS_TWIN":[("DNS","NETWORK_WINDOWS_DNS"),("Firewall","NETWORK_CYBER_FIREWALL"),("Networking","NETWORK_CLOUDOPS_ROUTING"),("Filesystem","LINUX_MIDDLEWARE_FILE_DESCRIPTORS"),("Connections","MIDDLEWARE_DATABASE_POOL"),("Kubernetes","DEVOPS_CLOUDOPS_DEPLOYMENT"),("Authentication","WINDOWS_DATABASE_AUTH"),("Identity","CYBER_IDENTITY"),("NetworkSignals","CYBER_NETWORK"),("Deployment","CLOUDOPS_DEVOPS_DRIFT")]
}
DIFF=["L1_BASIC","L2_INTERMEDIATE","L3_ADVANCED","L4_AMBIGUOUS","L6_CONTRADICTORY_EVIDENCE","L7_INSUFFICIENT_EVIDENCE","L8_HIGH_RISK_PRODUCTION","L3_ADVANCED","L4_AMBIGUOUS","L5_CROSS_DOMAIN"]
def make(twin,i,tech,root):
 abstain=DIFF[i]=="L7_INSUFFICIENT_EVIDENCE"; deps=[]
 if twin=="CROSS_TWIN": deps=[x for x in root.split("_") if x in {"NETWORK","WINDOWS","LINUX","MIDDLEWARE","DATABASE","CLOUDOPS","DEVOPS","CYBER"}]
 c=dict(BASE); c.update({"id":f"CZ-{twin}-{i+1:02d}","twin":twin,"domain":twin,"technology":tech,"incidentFamily":root,"difficulty":DIFF[i],"scenario":f"{tech} incident with symptoms requiring evidence-driven investigation for {root}.","symptoms":["User-visible failure","Telemetry is incomplete or mixed"],"observedEvidence":["INITIAL_SIGNAL"],"expectedHypotheses":[{"id":root,"acceptableAliases":[root.replace('_',' ')]}],"expectedNextAction":"COLLECT_RELEVANT_TELEMETRY","expectedTool":{"id":f"{tech.upper()}_DIAGNOSTIC"},"expectedRootCause":{"id":root,"acceptableAliases":[root.replace('_',' ')]},"expectedEscalation":deps[0] if deps else None,"crossTwinDependencies":deps,"shouldAbstain":abstain,"abstentionReason":"Critical discriminating evidence is unavailable." if abstain else ""})
 if i in (3,6): c["distractorEvidence"]=["MISLEADING_HEALTHY_SIGNAL"]
 if i==4: c["distractorEvidence"]=["CONTRADICTORY_TELEMETRY"]
 return c
def main():
 for twin,items in DATA.items():
  d=ROOT/("cross-twin" if twin=="CROSS_TWIN" else twin.lower()); d.mkdir(parents=True,exist_ok=True); p=d/"cases.jsonl"
  p.write_text("\n".join(json.dumps(make(twin,i,t,r),sort_keys=True) for i,(t,r) in enumerate(items))+"\n",encoding="utf-8")
if __name__=="__main__": main()
