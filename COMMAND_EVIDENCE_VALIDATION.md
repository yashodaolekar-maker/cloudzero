# Command-backed infrastructure validation

Agent handoffs now carry an evidence bundle for each completed check: persona, objective, allowlisted command, sanitized output, status, observation time, target CI, evidence ID and integrity hash. The visible A2A reply renders these checks above the next action. A model interprets this bundle; it does not construct executable command text.

Network plans start with interface and route state, then select bounded device checks from incident/CMDB context:

| Context | Read-only template |
| --- | --- |
| Router or BGP | `show ip bgp summary` |
| Switch/VLAN/L2 | `show cdp neighbors detail` |
| Firewall flow | `show session all filter source <reference> destination <reference>` |
| WLC/access point/client | `show wireless client mac-address <reference> detail` |
| SD-WAN | `show sdwan control connections` |

Windows validation on a separately correlated Windows CI records recent System errors, `Get-NetIPConfiguration`, effective IPv4 routes, `Test-NetConnection`, `Resolve-DnsName`, and configured DNS servers. Linux validation records failed services, recent error journal entries, addresses, routes, resolver output and a bounded TCP reachability test. Parameters accept only short identifiers; arbitrary command text is never accepted.

A Windows or Linux command is not sent to a network CI. Cross-team host validation requires a related incident with the exact same change identifier and the correct CI persona. Without that binding, the reply says evidence is required. A successful host check excludes only what it measured; it does not prove Windows is uninvolved in authentication, application, policy or time-dependent failures.

The local command proxy remains a simulator for non-demo devices. It returns explicit `SIMULATION` outputs and therefore cannot establish live device health. Production validation needs command-proxy adapters for each supported platform that translate these template IDs into vendor/version-specific read-only API or CLI operations, bind credentials and device scope server-side, and return sanitized output plus an audit reference. Do not accept raw commands from the browser, model or ticket description.

For training, first collect these replies through normal incident investigations and review their conclusions in **Digital Twins → Activity & reviews**. Training export retains the command evidence in the prompt and the corrected, reviewed reply as the target. Draft exercises can be created inside the dedicated training container:

```powershell
podman exec cloudzero-training python command_curriculum.py --output /workspace/network-command-drafts.jsonl
```

The drafts cover switch, router, firewall, WLC, access point and SD-WAN handoffs. They are deliberately marked `trainingReady: false`. A network and Windows engineer must correct the commands, outputs, inference and next check before assigning review provenance. Do not train on invented “healthy” outputs or convert simulator results into claims about real equipment.
