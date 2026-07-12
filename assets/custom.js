// document.addEventListener("DOMContentLoaded", function () {

//   const buttons = document.querySelectorAll(".delivery-date-button-custom");
//   const inputUI = document.getElementById("delivery-date-input-custom");
//   const inputForm = document.getElementById("delivery-date-input-final");
//   const atcBtn = document.querySelector("button[type='submit']");

//   if (!buttons.length || !inputUI || !inputForm || !atcBtn) return;

//   atcBtn.disabled = true;

//   buttons.forEach(btn => {
//     btn.addEventListener("click", function () {

//       buttons.forEach(b => b.classList.remove("active-custom"));
//       this.classList.add("active-custom");

//       const value = this.dataset.date;

//       inputUI.value = value;    
//       inputForm.value = value;  
//       atcBtn.disabled = false;
//     });
//   });
// });

