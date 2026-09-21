"""Targeted correction for the two known Network response collisions."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / '.data/training/user-proposed-prepared-network-v6'

def load(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]

def write(path, rows):
    path.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')

train_path = DATA / 'train.jsonl'
validation_path = DATA / 'validation.jsonl'
train = load(train_path)
validation = load(validation_path)

# SIM-VXLAN-VNI_MISMATCH-03 is a distinct incident from -01. Keep the
# stronger -01 response and make only -03's response specific to its evidence.
train[32]['messages'][-1]['content'] = json.dumps({
    'diagnosis': 'VNI mismatch between the local and remote VTEP for the affected segment.',
    'evidence': ['The incident identifies a VNI mismatch on the VXLAN tunnel.', 'The peer-specific VNI must be compared on both VTEPs.'],
    'validationChecks': ['show nve peers detail', 'show nve vni', 'show interface nve 1'],
    'rejectedHypothesis': 'Underlay reachability is not established as the cause without VTEP reachability and transport evidence.',
    'temporaryFix': 'After CAB approval, correct only the affected peer or segment VNI mapping.',
    'permanentFix': 'Reconcile VNI assignments against the approved overlay design and add drift detection.',
    'verification': 'The affected VTEP peer becomes established and the target VNI forwards traffic end to end.',
    'rollback': 'Restore the previous VNI mapping if peer state or traffic forwarding degrades.',
    'simulation': True
}, separators=(',', ':'))

# SIM-VLAN-ACCESS_PORT_ERROR-01 is a distinct validation incident. Make the
# response reference access-port state and host VLAN evidence.
validation[15]['messages'][-1]['content'] = json.dumps({
    'diagnosis': 'The access interface is assigned to a VLAN different from the intended host VLAN.',
    'evidence': ['The incident reports an access-port VLAN error.', 'The access VLAN and learned MAC placement must be checked on the affected interface.'],
    'validationChecks': ['show interface switchport', 'show vlan id <expected-vlan>', 'show mac address-table interface <interface>'],
    'rejectedHypothesis': 'A physical link fault is not implicated without link state, error counters, or negotiation evidence.',
    'temporaryFix': 'After CAB approval, assign the affected access port to the approved VLAN.',
    'permanentFix': 'Enforce access-port VLAN intent through configuration compliance and change validation.',
    'verification': 'The interface reports the approved access VLAN and the endpoint learns in that VLAN.',
    'rollback': 'Restore the prior access VLAN if endpoint connectivity or segmentation is adversely affected.',
    'simulation': True
}, separators=(',', ':'))

write(train_path, train)
write(validation_path, validation)
print('Updated exactly two assistant responses; retained 80 train and 18 validation records.')
