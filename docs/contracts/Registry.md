---
outline: deep
---
# Registry


### **Description**

a registry that let user send greetings to the world  It is used as a demo for jolly-roger,  a fully featured SDK to build entirely decentralised apps and games  It is inteded to be deployed via upgradeable proxy locally  to showcase the HCR (Hot Contract Replacement) capabilities of `hardhat-deploy`  but immutable on live networks.

## Functions

### **lastGreetingOf**

return the last greeting message from the given `user`.

*sig hash*: `0x03433b8e`

*Signature*: lastGreetingOf(address)

function lastGreetingOf(address user) view returns (string greeting)

| Name | Description 
| ---- | ----------- 
| user | address of the user.

### **messages**

return the last message from the given `user`.

*sig hash*: `0x5fdd59f8`

*Signature*: messages(address)

function messages(address user) view returns ((string content, uint256 timestamp, uint24 dayTimeInSeconds) userMsg)

| Name | Description 
| ---- | ----------- 
| user | address of the user.

### **prefix**

return the prefix that is appended to any new message.

*sig hash*: `0x75dadb32`

*Signature*: prefix()

function prefix() view returns (string value)

### **setMessage**

set a new message for `msg.sender`.

*sig hash*: `0x4c2dd808`

*Signature*: setMessage(string,uint24)

function setMessage(string message, uint24 dayTimeInSeconds)

| Name | Description 
| ---- | ----------- 
| message | the value to set as content.
| dayTimeInSeconds | the time of the day in seconds the message was written.

### **setMessageFor**

set a new message for `msg.sender`.

*sig hash*: `0x334c9bba`

*Signature*: setMessageFor(address,string,uint24)

function setMessageFor(address account, string message, uint24 dayTimeInSeconds)

| Name | Description 
| ---- | ----------- 
| account | address which will have its greetings set
| message | the value to set as content.
| dayTimeInSeconds | the time of the day in seconds the message was written.


## Events

### **MessageChanged**

emitted whenever a user set a new greeting to the world

event MessageChanged(address indexed user, uint256 timestamp, string message, uint24 dayTimeInSeconds)

| Name | Description 
| ---- | ----------- 
| user | the user that send the message
| timestamp | the time at which the message was recorded
| message | the message content
| dayTimeInSeconds | the time of the day in seconds where 00:00 => 0 and 23:59 => 82859


