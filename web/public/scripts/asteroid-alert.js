const $confirm = (text, buttonColor) => {
  return new Promise((resolve) => {
    var as_background = document.createElement('div');
    var as_box = document.createElement('div');
    var as_contentWrapper = document.createElement('div');
    var as_textnode = document.createElement('div');
    var as_okButton = document.createElement('button');
    var as_cancelButton = document.createElement('button');
    var as_buttonSection = document.createElement('div');

    as_okButton.innerText = 'Okay';
    as_cancelButton.innerText = 'Cancel';
    as_textnode.innerText = text;

    as_box.classList.add('as-box');
    as_background.classList.add('as-background');

    as_okButton.classList.add('as-okButton');
    as_okButton.setAttribute('id', 'as-okButton');
    as_cancelButton.classList.add('as-cancelButton');

    as_textnode.classList.add('as-textnode');
    as_buttonSection.classList.add('as-buttonSection');
    as_contentWrapper.classList.add('as-contentWrapper');

    as_box.style.backgroundColor = '#fff';
    as_okButton.style.backgroundColor = buttonColor || '#5AB9EA';
    as_okButton.style.color = '#fff';
    as_textnode.style.color = '#666666';

    as_box.appendChild(as_contentWrapper);
    as_contentWrapper.appendChild(as_textnode);
    as_contentWrapper.appendChild(as_buttonSection);
    as_buttonSection.appendChild(as_cancelButton);
    as_buttonSection.appendChild(as_okButton);
    as_background.appendChild(as_box);

    document.body.appendChild(as_background);

    var style = document.createElement('style');

    style.setAttribute('type', 'text/css');
    style.setAttribute('id', 'as_style_alertConfirm');

    style.innerHTML = `.as-box{
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 300px;
      border: 0px solid;
      border-radius: 5px; 
      padding: 20px;
      user-select: none;
      -ms-user-select: none;
      -moz-user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
  }
  .as-background{
      position: fixed;
      width: 100%;
      height: 100%;
      top: 0;
      left: 0; 
  
      background-color: rgba(0, 0, 0, 0.425);
      font-family: 'Heebo', sans-serif;
      z-index: 100000;  
  }
  .as-textnode{
      max-height: 500px;
      overflow-y: auto;
      font-size: 17px;
      word-wrap: break-word;
      line-height: 1.5;
      padding-right: 20px;
  }
  .as-textnode::-webkit-scrollbar{
      width: 5px;
  }
  .as-textnode::-webkit-scrollbar-thumb{
      background-color: #D5D8DC;
      border-radius: 10px;
  }
  .as-textnode{
      scrollbar-color: #D5D8DC;
      scrollbar-width: thin;
  }
  .as-okButton{
      border: 0px solid;
      border-radius: 3px;
      padding: 7px 9px;
      outline: none;
      font-size: 14px;
      cursor: pointer;
  }
  .as-cancelButton{
      border: 0px solid;
      border-radius: 3px;
      padding: 7px 9px;
      outline: none;
      font-size: 14px;
      cursor: pointer;
      background-color: #fff;
      color: #666666;
      margin-right: 5px;
  }
  .as-buttonSection{
      padding-top: 10px;
      display: flex;
      justify-content: flex-end;
  }
  @media only screen and (max-width: 576px) {
      .as-box {
          width: calc(100% - 30%);
      }
    }
  .as-box{animation:mymove 800ms;}
  @keyframes mymove{0% {opacity: 60%}
  .as-background{animation:fadein 800ms}
  @keyframes fadein{0% {opacity: 60%}`;

    document.head.appendChild(style);

    as_okButton.addEventListener('click', () => {
      asOkay();

      const back = true;
      if (back == true) {
        resolve();
      }
    });

    as_cancelButton.addEventListener('click', () => {
      asCancel();
    });

    function asOkay() {
      let as_style_alertConfirm = document.getElementById('as_style_alertConfirm');
      as_style_alertConfirm.remove();
      as_background.remove();
    }

    function asCancel() {
      let as_style_alertConfirm = document.getElementById('as_style_alertConfirm');
      as_style_alertConfirm.remove();
      as_background.remove();
    }
  });
};

function $toast(text, bgclr) {
  var as_toast = document.createElement('div');
  as_toast.classList.add('as-toast');
  as_toast.innerText = text;
  as_toast.style.backgroundColor = bgclr || '#2C3E50';

  var style = document.createElement('style');
  style.setAttribute('type', 'text/css');
  style.setAttribute('id', 'as_style_toast');

  style.innerHTML = `
  .as-toast{
      max-width: 200px;
      text-align: center;
      padding: 10px;
      font-size: 16px;
      font-family: sans-serif;
      border-radius: 3px;
      position: fixed;
      bottom: -10%;
      left: 50%;
      color: #fff;
      transform: translateX(-50%);
  
      animation-name: fadeinout;
      animation-duration: 2500ms;
  
      word-wrap: break-word;
      line-height: 1.4;
      letter-spacing: .4px;
      user-select: none;
      -ms-user-select: none;
      -moz-user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
  }
  
  @keyframes fadeinout{
      10%{bottom: 15%;  opacity: 100%}
      20%{bottom: 15%; opacity: 100%}
      40%{bottom: 15%; opacity: 100%}
      60%{bottom: 15%; opacity: 100%}
      80%{bottom: 15%; opacity: 100%}
     100%{bottom: -10%;  opacity: 100%}
  }`;

  setTimeout(function () {
    as_toast.remove();
    let as_style_toast = document.getElementById('as_style_toast');
    as_style_toast.remove();
  }, 2600);

  document.head.appendChild(style);
  document.body.appendChild(as_toast);
}

function $alert(text, buttonColor) {
  return new Promise((resolve) => {
    var as_background = document.createElement('div');
    var as_box = document.createElement('div');
    var as_contentWrapper = document.createElement('div');
    var as_textnode = document.createElement('div');
    var as_button = document.createElement('button');
    var as_buttonSection = document.createElement('div');

    as_button.innerText = 'Okay';
    as_textnode.innerText = text;

    as_box.classList.add('as-box');
    as_background.classList.add('as-background');
    as_button.classList.add('as-button');
    as_textnode.classList.add('as-textnode');
    as_buttonSection.classList.add('as-buttonSection');
    as_contentWrapper.classList.add('as-contentWrapper');

    as_box.style.backgroundColor = '#fff';
    as_button.style.backgroundColor = buttonColor || '#5AB9EA';
    as_button.style.color = '#fff';
    as_textnode.style.color = '#666666';

    as_box.appendChild(as_contentWrapper);
    as_contentWrapper.appendChild(as_textnode);
    as_contentWrapper.appendChild(as_buttonSection);
    as_buttonSection.appendChild(as_button);
    as_background.appendChild(as_box);
    document.body.appendChild(as_background);

    var style = document.createElement('style');

    style.setAttribute('type', 'text/css');
    style.setAttribute('id', 'as_style_basicAlert');

    style.innerHTML = `.as-box{
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 300px;
      border: 0px solid;
      border-radius: 5px; 
      padding: 20px;
      user-select: none;
      -ms-user-select: none;
      -moz-user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
  }
  .as-background{
      position: fixed;
      width: 100%;
      height: 100%;
      top: 0;
      left: 0; 
  
      background-color: rgba(0, 0, 0, 0.425);
      font-family: 'Heebo', sans-serif;
      z-index: 100000;  
  }
  .as-textnode{
      max-height: 500px;
      overflow-y: auto;
      font-size: 17px;
      word-wrap: break-word;
      line-height: 1.5;
      padding-right: 20px;
  }
  .as-textnode::-webkit-scrollbar{
      width: 5px;
  }
  .as-textnode::-webkit-scrollbar-thumb{
      background-color: #D5D8DC;
      border-radius: 10px;
  }
  .as-textnode{
      scrollbar-color: #D5D8DC;
      scrollbar-width: thin;
  }
  .as-button{
      border: 0px solid;
      border-radius: 3px;
      padding: 7px 9px;
      outline: none;
      font-size: 14px;
      cursor: pointer;
  }
  .as-buttonSection{
      padding-top: 10px;
      display: flex;
      justify-content: flex-end;
  }
  @media only screen and (max-width: 576px) {
      .as-box {
          width: calc(100% - 30%);
      }
    }
  .as-box{animation:mymove 800ms;}
  @keyframes mymove{0% {opacity: 60%}
  .as-background{animation:fadein 800ms}
  @keyframes fadein{0% {opacity: 60%}`;

    document.head.appendChild(style);

    as_button.addEventListener('click', () => {
      let as_style_basicAlert = document.getElementById('as_style_basicAlert');
      as_style_basicAlert.remove();
      as_background.remove();
      resolve();
    });
  });
}
